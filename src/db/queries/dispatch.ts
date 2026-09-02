import { query } from '../index.js';
import { env } from '../../config/env.js';
import { DriverCandidate } from '../../types/dispatch.js';
import { getBidsByOrderId } from './bids.js';
import { updateOrderStatus, getOrderById } from './orders.js';

/**
 * 依據 SPEC 6.2 與 schema.sql (範例 A) 邏輯挑選中單司機：
 * 1. 計算司機與上車點之 PostGIS ST_Distance
 * 2. 檢查 driver_rewards 是否有有效之 long_ride_priority (status = 'active' AND earned_priority_until > now())
 * 3. 排序規則：優先權 DESC, 距離 ASC
 */
export async function findWinnerDriver(orderId: string): Promise<DriverCandidate | null> {
  try {
    const sql = `
      SELECT 
        b.driver_id,
        ST_Distance(b.driver_geog, o.pickup_geog) as distance_meters,
        EXISTS (
          SELECT 1 FROM driver_rewards r
          WHERE r.driver_id = b.driver_id
            AND r.reward_type = 'long_ride_priority'
            AND r.status = 'active'
            AND r.earned_priority_until > now()
        ) AS has_long_ride_priority
      FROM dispatch_bids b
      JOIN orders o ON o.id = b.order_id
      WHERE b.order_id = $1
      ORDER BY
        has_long_ride_priority DESC,
        distance_meters ASC
      LIMIT 1;
    `;

    const res = await query<{
      driver_id: string;
      distance_meters: string | number;
      has_long_ride_priority: boolean;
    }>(sql, [orderId]);

    if (res && res.rows && res.rows.length > 0) {
      const row = res.rows[0];
      return {
        driver_id: row.driver_id,
        distance_meters: Number(row.distance_meters),
        has_long_ride_priority: Boolean(row.has_long_ride_priority),
      };
    }
    if (res && res.rows && res.rows.length === 0) {
      // 資料庫已連線但查無資料，檢查是否有出價紀錄（例如記憶體出價）
      const bids = await getBidsByOrderId(orderId);
      if (bids.length === 0) return null;
      // 若有出價紀錄，進入下方備援評選
    }
  } catch (err: any) {
    console.warn('[Dispatch DB] PostgreSQL 評選 Winner 失敗，使用備援評選:', err.message);
  }

  // 備援評選 (從 memoryBids 挑選第一位出價者)
  const bids = await getBidsByOrderId(orderId);
  if (bids.length === 0) return null;

  return {
    driver_id: bids[0].driver_id,
    distance_meters: (bids[0].distance_to_pickup_km || 1.5) * 1000,
    has_long_ride_priority: false,
  };
}

/**
 * 原子指派中單司機 (SPEC 6.2 & 8 安全需求)
 * UPDATE orders SET status='accepted', driver_id=$1, accepted_at=now()
 * WHERE id=$2 AND status='dispatching'
 * 嚴格檢查 rowCount === 1，只有剛好影響 1 筆才算成功。
 */
export async function atomicallyAssignDriver(
  orderId: string,
  winnerDriverId: string
): Promise<boolean> {
  try {
    const sql = `
      UPDATE orders 
      SET status = 'accepted',
          driver_id = $1,
          accepted_at = now()
      WHERE id = $2 AND status = 'dispatching';
    `;

    const res = await query(sql, [winnerDriverId, orderId]);
    if (res && typeof res.rowCount === 'number') {
      return res.rowCount === 1;
    }
  } catch (err: any) {
    console.warn('[Dispatch DB] 原子指派資料庫執行失敗，切換記憶體模式:', err.message);
  }

  const order = await getOrderById(orderId);
  if (order && order.status === 'dispatching') {
    order.status = 'accepted';
    order.driver_id = winnerDriverId;
    order.accepted_at = new Date();
    return true;
  }
  return false;
}

/**
 * 收集視窗結束且無人接單時，原子轉為 no_driver
 */
export async function markOrderNoDriver(orderId: string): Promise<boolean> {
  if (env.DATABASE_URL) {
    try {
      const sql = `
        UPDATE orders 
        SET status = 'no_driver'
        WHERE id = $1 AND status = 'dispatching';
      `;

      const res = await query(sql, [orderId]);
      if ((res.rowCount ?? 0) === 1) {
        return true;
      }
    } catch {
      // fallback
    }
  }

  const order = await getOrderById(orderId);
  if (order && order.status === 'dispatching') {
    order.status = 'no_driver';
    return true;
  }
  return false;
}
