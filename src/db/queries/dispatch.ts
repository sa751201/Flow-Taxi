import { query } from '../index.js';
import { DriverCandidate } from '../../types/dispatch.js';

/**
 * 依據 SPEC 6.2 與 schema.sql (範例 A) 邏輯挑選中單司機：
 * 1. 計算司機與上車點之 PostGIS ST_Distance
 * 2. 檢查 driver_rewards 是否有有效之 long_ride_priority (status = 'active' AND earned_priority_until > now())
 * 3. 排序規則：優先權 DESC, 距離 ASC
 */
export async function findWinnerDriver(orderId: string): Promise<DriverCandidate | null> {
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

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  return {
    driver_id: row.driver_id,
    distance_meters: Number(row.distance_meters),
    has_long_ride_priority: Boolean(row.has_long_ride_priority),
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
  const sql = `
    UPDATE orders 
    SET status = 'accepted',
        driver_id = $1,
        accepted_at = now()
    WHERE id = $2 AND status = 'dispatching';
  `;

  const res = await query(sql, [winnerDriverId, orderId]);
  return (res.rowCount ?? 0) === 1;
}

/**
 * 收集視窗結束且無人接單時，原子轉為 no_driver
 */
export async function markOrderNoDriver(orderId: string): Promise<boolean> {
  const sql = `
    UPDATE orders 
    SET status = 'no_driver'
    WHERE id = $1 AND status = 'dispatching';
  `;

  const res = await query(sql, [orderId]);
  return (res.rowCount ?? 0) === 1;
}
