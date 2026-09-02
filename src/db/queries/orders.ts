import { query } from '../index.js';
import { env } from '../../config/env.js';
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

// 記憶體備援快取 (保障在 PostgreSQL 斷線或未設定 DATABASE_URL 時派單不中斷)
const memoryOrders = new Map<string, Order>();

export async function createOrder(params: CreateOrderParams): Promise<Order> {
  if (env.DATABASE_URL) {
    try {
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
      if (res.rows[0]) {
        memoryOrders.set(res.rows[0].id, res.rows[0]);
        return res.rows[0];
      }
    } catch (dbErr: any) {
      console.warn('[Orders DB] PostgreSQL 建立訂單失敗，切換至備援存儲:', dbErr.message);
    }
  }

  // 備援存儲
  const generatedId = params.id || 'order-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const fallbackOrder: Order = {
    id: generatedId,
    customer_id: params.customer_id,
    service_type: (params.service_type as any) || 'city',
    pickup_address: params.pickup_address,
    dropoff_address: params.dropoff_address,
    passenger_count: params.passenger_count || 1,
    scheduled_time: params.scheduled_time || null,
    region: params.region || null,
    note: params.note || null,
    distance_km: params.distance_km || null,
    fare: params.fare || null,
    status: 'pending',
    created_at: new Date(),
  };

  memoryOrders.set(generatedId, fallbackOrder);
  return fallbackOrder;
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  if (env.DATABASE_URL) {
    try {
      const sql = 'SELECT * FROM orders WHERE id = $1';
      const res = await query<Order>(sql, [orderId]);
      if (res.rows[0]) return res.rows[0];
    } catch {
      // fallback
    }
  }
  return memoryOrders.get(orderId) || null;
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  expectedCurrentStatus?: OrderStatus
): Promise<boolean> {
  if (env.DATABASE_URL) {
    try {
      let sql = 'UPDATE orders SET status = $1 WHERE id = $2';
      const params: any[] = [newStatus, orderId];

      if (expectedCurrentStatus) {
        sql += ' AND status = $3';
        params.push(expectedCurrentStatus);
      }

      const res = await query(sql, params);
      if ((res.rowCount ?? 0) === 1) {
        const cached = memoryOrders.get(orderId);
        if (cached) cached.status = newStatus;
        return true;
      }
    } catch {
      // fallback
    }
  }

  const cached = memoryOrders.get(orderId);
  if (cached) {
    if (expectedCurrentStatus && cached.status !== expectedCurrentStatus) {
      return false;
    }
    cached.status = newStatus;
    return true;
  }
  return false;
}

export async function markOrderDispatching(orderId: string): Promise<boolean> {
  if (env.DATABASE_URL) {
    try {
      const sql = `
        UPDATE orders 
        SET status = 'dispatching', dispatched_at = now()
        WHERE id = $1 AND status = 'pending';
      `;
      const res = await query(sql, [orderId]);
      if ((res.rowCount ?? 0) === 1) {
        const cached = memoryOrders.get(orderId);
        if (cached) {
          cached.status = 'dispatching';
          cached.dispatched_at = new Date();
        }
        return true;
      }
    } catch {
      // fallback
    }
  }

  const cached = memoryOrders.get(orderId);
  if (cached && cached.status === 'pending') {
    cached.status = 'dispatching';
    cached.dispatched_at = new Date();
    return true;
  }
  return false;
}
