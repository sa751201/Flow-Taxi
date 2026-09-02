import { env } from '../config/env.js';
import { DispatchTimer } from './timer/timer-interface.js';
import { MemoryDispatchTimer } from './timer/memory-timer.js';
import { getOrderById, markOrderDispatching } from '../db/queries/orders.js';
import { insertBid, getBidsByOrderId, SubmitBidParams } from '../db/queries/bids.js';
import {
  findWinnerDriver,
  atomicallyAssignDriver,
  markOrderNoDriver,
} from '../db/queries/dispatch.js';
import { DispatchWinnerResult } from '../types/dispatch.js';

// 派單視窗硬上限：60 秒（防止任何環境變數或參數覆蓋）
const MAX_DISPATCH_WINDOW_SECONDS = 60;

export interface DispatchEngineOptions {
  timer?: DispatchTimer;
  windowDurationSeconds?: number;
  onOrderResolved?: (result: DispatchWinnerResult) => Promise<void>;
}

export class DispatchEngine {
  private timer: DispatchTimer;
  private windowDurationSeconds: number;
  private onOrderResolved?: (result: DispatchWinnerResult) => Promise<void>;

  constructor(options?: DispatchEngineOptions) {
    // 強制上限 60 秒，無論 env 或傳入值設為多少
    const rawDuration = options?.windowDurationSeconds ?? env.DISPATCH_WINDOW_SECONDS;
    this.windowDurationSeconds = Math.min(rawDuration, MAX_DISPATCH_WINDOW_SECONDS);
    this.onOrderResolved = options?.onOrderResolved;

    // 所有環境一律使用 MemoryDispatchTimer（Node.js setTimeout）
    // BullMQ delayed job 在遠端 Redis 上有 Worker 輪詢延遲，不適合短秒數精確定時
    if (options?.timer) {
      this.timer = options.timer;
    } else {
      this.timer = new MemoryDispatchTimer();
    }

    console.log(`[DispatchEngine] 初始化完成 | 計時器: MemoryDispatchTimer | 派單視窗: ${this.windowDurationSeconds}s`);
  }

  /**
   * 1. 發起派單（pending -> dispatching）並啟動收集視窗
   */
  async startDispatch(orderId: string, customDurationSeconds?: number): Promise<{ success: boolean; message?: string }> {
    const order = await getOrderById(orderId);
    if (!order) {
      return { success: false, message: `Order ${orderId} not found` };
    }

    if (order.status !== 'pending') {
      return {
        success: false,
        message: `Order status is '${order.status}', cannot start dispatch (requires 'pending')`,
      };
    }

    const updated = await markOrderDispatching(orderId);
    if (!updated) {
      return { success: false, message: 'Failed to update order status to dispatching (race condition)' };
    }

    // 強制上限 60 秒，防止任何來源傳入超過 60 秒的值
    const duration = Math.min(
      customDurationSeconds ?? this.windowDurationSeconds,
      MAX_DISPATCH_WINDOW_SECONDS
    );

    // 使用 MemoryDispatchTimer 精準的 Node.js setTimeout 計時
    try {
      await this.timer.startWindow(orderId, duration, async (expiredOrderId) => {
        console.log(`[DispatchEngine] 視窗到期 (${duration}s) for order: ${expiredOrderId}. 開始結單...`);
        await this.closeDispatchWindow(expiredOrderId);
      });
    } catch (tErr: any) {
      console.error('[DispatchEngine] 計時器啟動失敗:', tErr.message);
      // 緊急備援：直接用原生 setTimeout
      setTimeout(async () => {
        console.log(`[DispatchEngine] 緊急備援計時器到期 for order: ${orderId}`);
        await this.closeDispatchWindow(orderId);
      }, duration * 1000);
    }

    console.log(`[DispatchEngine] Order ${orderId} 已開始派單。視窗 ${duration} 秒。`);
    return { success: true };
  }

  /**
   * 2. 司機出價（寫入 dispatch_bids）
   */
  async submitBid(params: SubmitBidParams) {
    const order = await getOrderById(params.orderId);
    if (!order) {
      throw new Error(`訂單不存在或編號錯誤 (${params.orderId})`);
    }

    if (order.status === 'pending') {
      // 若尚未轉換狀態，自動切換為 dispatching
      await markOrderDispatching(params.orderId);
      order.status = 'dispatching';
    } else if (order.status === 'no_driver') {
      throw new Error(`此訂單派單媒合時間已逾時結束，請等待下一筆訂單 (Order is not in dispatching state: no_driver)`);
    } else if (order.status === 'accepted') {
      throw new Error(`此訂單已由其他司機中單承接 (Order is not in dispatching state: accepted)`);
    } else if (order.status !== 'dispatching') {
      throw new Error(`訂單目前狀態無法接單 (Order is not in dispatching state: ${order.status})`);
    }

    return await insertBid(params);
  }

  /**
   * 3. 收集視窗關閉並進行原子指派
   */
  async closeDispatchWindow(orderId: string): Promise<DispatchWinnerResult> {
    // 取得所有出價總數
    const bids = await getBidsByOrderId(orderId);
    const totalBidsCount = bids.length;

    // 若無出價司機
    if (totalBidsCount === 0) {
      const marked = await markOrderNoDriver(orderId);
      console.log(`[DispatchEngine] Order ${orderId} closed with 0 bids. Marked no_driver: ${marked}`);
      const result: DispatchWinnerResult = {
        orderId,
        status: marked ? 'no_driver' : 'conflict_or_cancelled',
        totalBidsCount: 0,
      };
      if (this.onOrderResolved) {
        try {
          await this.onOrderResolved(result);
        } catch (err: any) {
          console.error('[DispatchEngine] onOrderResolved 執行失敗:', err.message);
        }
      }
      return result;
    }

    // PostGIS 依長單優先權加權 + 距離排序挑選 Winner
    const candidate = await findWinnerDriver(orderId);
    if (!candidate) {
      const marked = await markOrderNoDriver(orderId);
      const result: DispatchWinnerResult = {
        orderId,
        status: marked ? 'no_driver' : 'conflict_or_cancelled',
        totalBidsCount,
      };
      if (this.onOrderResolved) {
        try {
          await this.onOrderResolved(result);
        } catch (err: any) {
          console.error('[DispatchEngine] onOrderResolved 執行失敗:', err.message);
        }
      }
      return result;
    }

    // 原子指派：UPDATE orders SET status='accepted', driver_id=$1 WHERE id=$2 AND status='dispatching'
    const assigned = await atomicallyAssignDriver(orderId, candidate.driver_id);

    if (!assigned) {
      console.warn(`[DispatchEngine] Atomic assignment failed for order ${orderId} (race condition / cancelled)`);
      const result: DispatchWinnerResult = {
        orderId,
        status: 'conflict_or_cancelled',
        totalBidsCount,
      };
      if (this.onOrderResolved) {
        try {
          await this.onOrderResolved(result);
        } catch (err: any) {
          console.error('[DispatchEngine] onOrderResolved 執行失敗:', err.message);
        }
      }
      return result;
    }

    console.log(
      `[DispatchEngine] Order ${orderId} successfully assigned to driver ${candidate.driver_id} (Distance: ${candidate.distance_meters.toFixed(1)}m, Priority: ${candidate.has_long_ride_priority})`
    );

    const result: DispatchWinnerResult = {
      orderId,
      status: 'assigned',
      winnerDriverId: candidate.driver_id,
      distanceMeters: candidate.distance_meters,
      hasPriority: candidate.has_long_ride_priority,
      totalBidsCount,
    };

    if (this.onOrderResolved) {
      try {
        await this.onOrderResolved(result);
      } catch (err: any) {
        console.error('[DispatchEngine] onOrderResolved 執行失敗:', err.message);
      }
    }

    return result;
  }

  /**
   * 4. 取消派單
   */
  async cancelDispatch(orderId: string): Promise<void> {
    await this.timer.cancelWindow(orderId);
  }

  /**
   * 5. 關閉服務釋放定時器
   */
  async close(): Promise<void> {
    await this.timer.close();
  }
}
