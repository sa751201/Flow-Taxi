import { env } from '../config/env.js';
import { DispatchTimer } from './timer/timer-interface.js';
import { MemoryDispatchTimer } from './timer/memory-timer.js';
import { BullMQDispatchTimer } from './timer/bullmq-timer.js';
import { getOrderById, markOrderDispatching } from '../db/queries/orders.js';
import { insertBid, getBidsByOrderId, SubmitBidParams } from '../db/queries/bids.js';
import {
  findWinnerDriver,
  atomicallyAssignDriver,
  markOrderNoDriver,
} from '../db/queries/dispatch.js';
import { DispatchWinnerResult } from '../types/dispatch.js';

export interface DispatchEngineOptions {
  timer?: DispatchTimer;
  windowDurationSeconds?: number;
}

export class DispatchEngine {
  private timer: DispatchTimer;
  private windowDurationSeconds: number;

  constructor(options?: DispatchEngineOptions) {
    this.windowDurationSeconds = options?.windowDurationSeconds ?? env.DISPATCH_WINDOW_SECONDS;

    if (options?.timer) {
      this.timer = options.timer;
    } else if (env.REDIS_URL && env.NODE_ENV === 'production') {
      this.timer = new BullMQDispatchTimer(env.REDIS_URL);
    } else {
      this.timer = new MemoryDispatchTimer();
    }
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

    const duration = customDurationSeconds ?? this.windowDurationSeconds;

    // 啟動視窗計時
    await this.timer.startWindow(orderId, duration, async (expiredOrderId) => {
      console.log(`[DispatchEngine] Window expired for order: ${expiredOrderId}. Resolving winner...`);
      await this.closeDispatchWindow(expiredOrderId);
    });

    console.log(`[DispatchEngine] Order ${orderId} is now dispatching. Window open for ${duration}s.`);
    return { success: true };
  }

  /**
   * 2. 司機出價（寫入 dispatch_bids）
   */
  async submitBid(params: SubmitBidParams) {
    const order = await getOrderById(params.orderId);
    if (!order) {
      throw new Error(`Order ${params.orderId} does not exist`);
    }

    if (order.status !== 'dispatching') {
      throw new Error(`Order ${params.orderId} is not in dispatching state (current: ${order.status})`);
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
      return {
        orderId,
        status: marked ? 'no_driver' : 'conflict_or_cancelled',
        totalBidsCount: 0,
      };
    }

    // PostGIS 依長單優先權加權 + 距離排序挑選 Winner
    const candidate = await findWinnerDriver(orderId);
    if (!candidate) {
      const marked = await markOrderNoDriver(orderId);
      return {
        orderId,
        status: marked ? 'no_driver' : 'conflict_or_cancelled',
        totalBidsCount,
      };
    }

    // 原子指派：UPDATE orders SET status='accepted', driver_id=$1 WHERE id=$2 AND status='dispatching'
    const assigned = await atomicallyAssignDriver(orderId, candidate.driver_id);

    if (!assigned) {
      console.warn(`[DispatchEngine] Atomic assignment failed for order ${orderId} (race condition / cancelled)`);
      return {
        orderId,
        status: 'conflict_or_cancelled',
        totalBidsCount,
      };
    }

    console.log(
      `[DispatchEngine] Order ${orderId} successfully assigned to driver ${candidate.driver_id} (Distance: ${candidate.distance_meters.toFixed(1)}m, Priority: ${candidate.has_long_ride_priority})`
    );

    return {
      orderId,
      status: 'assigned',
      winnerDriverId: candidate.driver_id,
      distanceMeters: candidate.distance_meters,
      hasPriority: candidate.has_long_ride_priority,
      totalBidsCount,
    };
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
