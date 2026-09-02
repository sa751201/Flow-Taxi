import { query } from '../index.js';
import { env } from '../../config/env.js';
import { DispatchBid } from '../../types/dispatch.js';

export interface SubmitBidParams {
  orderId: string;
  driverId: string;
  lat: number;
  lng: number;
  etaMinutes?: number | null;
}

// 記憶體備援出價儲存
const memoryBids = new Map<string, DispatchBid[]>();

export async function insertBid(params: SubmitBidParams): Promise<DispatchBid> {
  if (env.DATABASE_URL) {
    try {
      const sql = `
        INSERT INTO dispatch_bids (
          order_id,
          driver_id,
          driver_geog,
          distance_to_pickup_km,
          eta_minutes,
          bid_at
        )
        SELECT
          $1,
          $2,
          driver_pt,
          ST_Distance(driver_pt, o.pickup_geog) / 1000.0,
          $5,
          now()
        FROM 
          (SELECT ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography AS driver_pt) pt,
          orders o
        WHERE o.id = $1 AND o.status = 'dispatching'
        ON CONFLICT (order_id, driver_id) 
        DO UPDATE SET
          driver_geog = EXCLUDED.driver_geog,
          distance_to_pickup_km = EXCLUDED.distance_to_pickup_km,
          eta_minutes = EXCLUDED.eta_minutes,
          bid_at = now()
        RETURNING id, order_id, driver_id, distance_to_pickup_km, eta_minutes, bid_at;
      `;

      const values = [
        params.orderId,
        params.driverId,
        params.lng,
        params.lat,
        params.etaMinutes ?? null,
      ];

      const res = await query<DispatchBid>(sql, values);
      if (res.rows.length > 0) {
        const bid = res.rows[0];
        const existing = memoryBids.get(params.orderId) || [];
        memoryBids.set(params.orderId, [...existing.filter(b => b.driver_id !== params.driverId), bid]);
        return bid;
      }
    } catch (dbErr: any) {
      console.warn('[Bids DB] PostgreSQL 寫入出價失敗，切換至備援存儲:', dbErr.message);
    }
  }

  // 備援儲存
  const newBid: DispatchBid = {
    id: 'bid-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    order_id: params.orderId,
    driver_id: params.driverId,
    distance_to_pickup_km: 1.5,
    eta_minutes: params.etaMinutes ?? 5,
    bid_at: new Date(),
  };

  const currentList = memoryBids.get(params.orderId) || [];
  const updatedList = [...currentList.filter(b => b.driver_id !== params.driverId), newBid];
  memoryBids.set(params.orderId, updatedList);

  return newBid;
}

export async function getBidsByOrderId(orderId: string): Promise<DispatchBid[]> {
  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT id, order_id, driver_id, distance_to_pickup_km, eta_minutes, bid_at
        FROM dispatch_bids
        WHERE order_id = $1
        ORDER BY distance_to_pickup_km ASC;
      `;
      const res = await query<DispatchBid>(sql, [orderId]);
      if (res.rows.length > 0) return res.rows;
    } catch {
      // fallback
    }
  }

  return memoryBids.get(orderId) || [];
}
