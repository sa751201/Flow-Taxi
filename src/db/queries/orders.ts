import { query } from '../index.js';
import { Order, OrderStatus } from '../../types/dispatch.js';

export interface CreateOrderParams {
  id?: string;
  customer_id: string;
  service_type?: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address?: string;
  dropoff_lat?: number;
  dropoff_lng?: number;
  passenger_count?: number;
  scheduled_time?: Date | null;
  region?: string | null;
  note?: string | null;
  distance_km?: number | null;
  fare?: number | null;
}

export async function createOrder(params: CreateOrderParams): Promise<Order> {
  const sql = `
    INSERT INTO orders (
      ${params.id ? 'id,' : ''}
      customer_id,
      service_type,
      pickup_address,
      pickup_geog,
      dropoff_address,
      dropoff_geog,
      passenger_count,
      scheduled_time,
      region,
      note,
      distance_km,
      fare,
      status
    ) VALUES (
      ${params.id ? '$1,' : ''}
      $${params.id ? 2 : 1},
      $${params.id ? 3 : 2},
      $${params.id ? 4 : 3},
      ST_SetSRID(ST_MakePoint($${params.id ? 5 : 4}, $${params.id ? 6 : 5}), 4326)::geography,
      $${params.id ? 7 : 6},
      ${params.dropoff_lat && params.dropoff_lng ? `ST_SetSRID(ST_MakePoint($${params.id ? 8 : 7}, $${params.id ? 9 : 8}), 4326)::geography` : 'NULL'},
      $${params.id ? 10 : 9},
      $${params.id ? 11 : 10},
      $${params.id ? 12 : 11},
      $${params.id ? 13 : 12},
      $${params.id ? 14 : 13},
      $${params.id ? 15 : 14},
      'pending'
    )
    RETURNING *;
  `;

  const values = params.id
    ? [
        params.id,
        params.customer_id,
        params.service_type || 'city',
        params.pickup_address,
        params.pickup_lng,
        params.pickup_lat,
        params.dropoff_address || null,
        ...(params.dropoff_lat && params.dropoff_lng ? [params.dropoff_lng, params.dropoff_lat] : []),
        params.passenger_count || 1,
        params.scheduled_time || null,
        params.region || null,
        params.note || null,
        params.distance_km || null,
        params.fare || null,
      ]
    : [
        params.customer_id,
        params.service_type || 'city',
        params.pickup_address,
        params.pickup_lng,
        params.pickup_lat,
        params.dropoff_address || null,
        ...(params.dropoff_lat && params.dropoff_lng ? [params.dropoff_lng, params.dropoff_lat] : []),
        params.passenger_count || 1,
        params.scheduled_time || null,
        params.region || null,
        params.note || null,
        params.distance_km || null,
        params.fare || null,
      ];

  const res = await query<Order>(sql, values);
  return res.rows[0];
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  const sql = 'SELECT * FROM orders WHERE id = $1';
  const res = await query<Order>(sql, [orderId]);
  return res.rows[0] || null;
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  expectedCurrentStatus?: OrderStatus
): Promise<boolean> {
  let sql = 'UPDATE orders SET status = $1 WHERE id = $2';
  const params: any[] = [newStatus, orderId];

  if (expectedCurrentStatus) {
    sql += ' AND status = $3';
    params.push(expectedCurrentStatus);
  }

  const res = await query(sql, params);
  return (res.rowCount ?? 0) === 1;
}

export async function markOrderDispatching(orderId: string): Promise<boolean> {
  const sql = `
    UPDATE orders 
    SET status = 'dispatching', dispatched_at = now()
    WHERE id = $1 AND status = 'pending';
  `;
  const res = await query(sql, [orderId]);
  return (res.rowCount ?? 0) === 1;
}
