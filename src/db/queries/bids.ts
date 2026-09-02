import { query } from '../index.js';
import { DispatchBid } from '../../types/dispatch.js';

export interface SubmitBidParams {
  orderId: string;
  driverId: string;
  lat: number;
  lng: number;
  etaMinutes?: number | null;
}

export async function insertBid(params: SubmitBidParams): Promise<DispatchBid> {
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
  if (res.rows.length === 0) {
    throw new Error(`Cannot submit bid: order ${params.orderId} is not in dispatching state or does not exist`);
  }
  return res.rows[0];
}

export async function getBidsByOrderId(orderId: string): Promise<DispatchBid[]> {
  const sql = `
    SELECT id, order_id, driver_id, distance_to_pickup_km, eta_minutes, bid_at
    FROM dispatch_bids
    WHERE order_id = $1
    ORDER BY distance_to_pickup_km ASC;
  `;
  const res = await query<DispatchBid>(sql, [orderId]);
  return res.rows;
}
