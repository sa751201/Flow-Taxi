import { query } from '../index.js';
import { env } from '../../config/env.js';
import { Order, OrderStatus } from '../../types/dispatch.js';
import { getDriverById, findDriverByPhoneOrPlate } from './drivers.js';
import { isFutureReservation } from '../../services/reservation.js';

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

export { Order, OrderStatus };

// 記憶體備援快取 (保障在 PostgreSQL 斷線或未設定 DATABASE_URL 時派單不中斷)
export const memoryOrders = new Map<string, Order>();

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
        RETURNING *,
          ST_Y(pickup_geog::geometry) as pickup_lat,
          ST_X(pickup_geog::geometry) as pickup_lng,
          ST_Y(dropoff_geog::geometry) as dropoff_lat,
          ST_X(dropoff_geog::geometry) as dropoff_lng;
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
    pickup_lat: params.pickup_lat,
    pickup_lng: params.pickup_lng,
    dropoff_address: params.dropoff_address,
    dropoff_lat: params.dropoff_lat,
    dropoff_lng: params.dropoff_lng,
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
      const sql = `
        SELECT *,
          ST_Y(pickup_geog::geometry) as pickup_lat,
          ST_X(pickup_geog::geometry) as pickup_lng,
          ST_Y(dropoff_geog::geometry) as dropoff_lat,
          ST_X(dropoff_geog::geometry) as dropoff_lng
        FROM orders WHERE id = $1
      `;
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
      let setClauses = ['status = $1'];
      if (newStatus === 'picked_up') {
        setClauses.push('picked_up_at = now()');
      } else if (newStatus === 'done') {
        setClauses.push('completed_at = now()');
      } else if (newStatus === 'cancelled') {
        setClauses.push('cancelled_at = now()');
      }

      let sql = `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $2`;
      const params: any[] = [newStatus, orderId];

      if (expectedCurrentStatus) {
        sql += ' AND status = $3';
        params.push(expectedCurrentStatus);
      }

      const res = await query(sql, params);
      if ((res.rowCount ?? 0) === 1) {
        const cached = memoryOrders.get(orderId);
        if (cached) {
          cached.status = newStatus;
          if (newStatus === 'picked_up') cached.picked_up_at = new Date();
          if (newStatus === 'done') cached.completed_at = new Date();
          if (newStatus === 'cancelled') cached.cancelled_at = new Date();
        }
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
    if (newStatus === 'picked_up') cached.picked_up_at = new Date();
    if (newStatus === 'done') cached.completed_at = new Date();
    if (newStatus === 'cancelled') cached.cancelled_at = new Date();
    return true;
  }
  return false;
}

/**
 * 更新訂單的下車地點與行駛距離 (供司機回報短程單使用)
 */
export async function updateOrderDropoffAndDistance(
  orderId: string,
  dropoffAddress: string,
  distanceKm: number,
  isShortTrip: boolean
): Promise<boolean> {
  if (env.DATABASE_URL) {
    try {
      const sql = `
        UPDATE orders 
        SET dropoff_address = $1, distance_km = $2, note = COALESCE(note, '') || $3
        WHERE id = $4;
      `;
      const noteAppend = isShortTrip ? ' [司機回報短程單]' : '';
      const res = await query(sql, [dropoffAddress, distanceKm, noteAppend, orderId]);
      if ((res.rowCount ?? 0) >= 1) {
        const cached = memoryOrders.get(orderId);
        if (cached) {
          cached.dropoff_address = dropoffAddress;
          cached.distance_km = distanceKm;
          cached.note = (cached.note || '') + noteAppend;
        }
        return true;
      }
    } catch (e: any) {
      console.warn('[Orders DB] 更新下車點與里程失敗，切換至備援:', e.message);
    }
  }

  const cached = memoryOrders.get(orderId);
  if (cached) {
    cached.dropoff_address = dropoffAddress;
    cached.distance_km = distanceKm;
    cached.note = (cached.note || '') + (isShortTrip ? ' [司機回報短程單]' : '');
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

/**
 * 標記司機已到達上車點 (記錄至備援記憶體與 orders.note)
 */
export async function markDriverArrived(orderId: string): Promise<boolean> {
  const cached = memoryOrders.get(orderId);
  if (cached) {
    (cached as any).driver_arrived = true;
    if (!cached.note?.includes('[DRIVER_ARRIVED]')) {
      cached.note = (cached.note ? cached.note + ' ' : '') + '[DRIVER_ARRIVED]';
    }
  }

  if (env.DATABASE_URL) {
    try {
      const sql = `
        UPDATE orders 
        SET note = COALESCE(note, '') || ' [DRIVER_ARRIVED]'
        WHERE id = $1 AND (note IS NULL OR note NOT LIKE '%[DRIVER_ARRIVED]%');
      `;
      await query(sql, [orderId]);
      return true;
    } catch (e: any) {
      console.warn('[Orders DB] 標記司機已到達失敗:', e.message);
    }
  }

  return true;
}

/**
 * 查詢司機目前正在執行的活躍訂單 (accepted / in_progress / picked_up)
 * 支援傳入 LINE User ID、車牌號碼 (如 CEQ-7710)、姓名 (如 Mike Wang) 或電話
 */
export async function getActiveOrderByDriverId(driverId: string): Promise<Order | null> {
  // 1. 快速先查記憶體快取中是否有直接符合 driver_id 的活躍訂單 (過濾未到出車時間之預約單)
  for (const order of memoryOrders.values()) {
    if (
      order.driver_id === driverId &&
      (order.status === 'accepted' || (order as any).status === 'in_progress' || order.status === 'picked_up') &&
      !isFutureReservation(order)
    ) {
      return order;
    }
  }

  const searchIds = new Set<string>([driverId]);
  try {
    const driverPromise = (async () => {
      return (await getDriverById(driverId)) || (await findDriverByPhoneOrPlate(driverId));
    })();
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 800));
    const driver = await Promise.race([driverPromise, timeoutPromise]);
    if (driver) {
      if (driver.line_user_id) searchIds.add(driver.line_user_id);
      if (driver.plate_number) searchIds.add(driver.plate_number);
      if (driver.display_name) searchIds.add(driver.display_name);
    }
  } catch {}

  const idsArray = Array.from(searchIds);

  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT *,
          ST_Y(pickup_geog::geometry) as pickup_lat,
          ST_X(pickup_geog::geometry) as pickup_lng,
          ST_Y(dropoff_geog::geometry) as dropoff_lat,
          ST_X(dropoff_geog::geometry) as dropoff_lng
        FROM orders 
        WHERE driver_id = ANY($1::text[]) AND status IN ('accepted', 'in_progress', 'picked_up')
        ORDER BY created_at DESC;
      `;
      const res = await query<Order>(sql, [idsArray]);
      for (const row of res.rows) {
        if (!isFutureReservation(row)) {
          return row;
        }
      }
    } catch {
      // fallback
    }
  }

  // 記憶體備援查詢 (多身分解析)
  for (const order of memoryOrders.values()) {
    if (
      order.driver_id &&
      searchIds.has(order.driver_id) &&
      (order.status === 'accepted' || (order as any).status === 'in_progress' || order.status === 'picked_up') &&
      !isFutureReservation(order)
    ) {
      return order;
    }
  }

  return null;
}

/**
 * 查詢司機目前已接單但尚未到出車時間之「預約行程」清單
 */
export async function getScheduledOrdersByDriverId(driverId: string): Promise<Order[]> {
  const searchIds = new Set<string>([driverId]);
  try {
    const driver = (await getDriverById(driverId)) || (await findDriverByPhoneOrPlate(driverId));
    if (driver) {
      if (driver.line_user_id) searchIds.add(driver.line_user_id);
      if (driver.plate_number) searchIds.add(driver.plate_number);
      if (driver.display_name) searchIds.add(driver.display_name);
    }
  } catch {}

  const idsArray = Array.from(searchIds);
  const scheduledOrders: Order[] = [];

  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT *,
          ST_Y(pickup_geog::geometry) as pickup_lat,
          ST_X(pickup_geog::geometry) as pickup_lng,
          ST_Y(dropoff_geog::geometry) as dropoff_lat,
          ST_X(dropoff_geog::geometry) as dropoff_lng
        FROM orders 
        WHERE driver_id = ANY($1::text[]) AND status = 'accepted'
        ORDER BY scheduled_time ASC NULLS LAST, created_at DESC;
      `;
      const res = await query<Order>(sql, [idsArray]);
      for (const row of res.rows) {
        if (isFutureReservation(row)) {
          scheduledOrders.push(row);
        }
      }
      return scheduledOrders;
    } catch {}
  }

  // 記憶體備援
  for (const order of memoryOrders.values()) {
    if (
      order.driver_id &&
      searchIds.has(order.driver_id) &&
      order.status === 'accepted' &&
      isFutureReservation(order)
    ) {
      scheduledOrders.push(order);
    }
  }

  return scheduledOrders.sort((a, b) => {
    const timeA = a.scheduled_time ? new Date(a.scheduled_time).getTime() : 0;
    const timeB = b.scheduled_time ? new Date(b.scheduled_time).getTime() : 0;
    return timeA - timeB;
  });
}

/**
 * 查詢乘客目前所有進行中的活躍訂單列表
 */
export async function getActiveOrdersByCustomerId(customerId: string): Promise<Order[]> {
  const activeOrders: Order[] = [];

  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT * FROM orders 
        WHERE customer_id = $1 AND status IN ('pending', 'dispatching', 'accepted', 'in_progress', 'picked_up')
        ORDER BY created_at DESC;
      `;
      const res = await query<Order>(sql, [customerId]);
      return res.rows;
    } catch {}
  }

  for (const order of memoryOrders.values()) {
    if (
      order.customer_id === customerId &&
      ['pending', 'dispatching', 'accepted', 'in_progress', 'picked_up'].includes(order.status)
    ) {
      activeOrders.push(order);
    }
  }

  return activeOrders;
}

/**
 * 查詢乘客目前正在進行中的活躍訂單 (即時單優先原則)
 */
export async function getActiveOrderByCustomerId(customerId: string): Promise<Order | null> {
  const orders = await getActiveOrdersByCustomerId(customerId);
  if (orders.length === 0) return null;
  if (orders.length === 1) return orders[0];

  // 即時單優先原則：若有非未來預約單（即時單或已到出車時間之訂單），以即時單優先！
  const instantOrder = orders.find((o) => !isFutureReservation(o));
  if (instantOrder) return instantOrder;

  return orders[0];
}

/**
 * 查詢特定經緯度半徑 (公里) 內正在派單 (dispatching) 的訂單
 */
export async function getNearbyOrders(
  lat: number,
  lng: number,
  radiusKm: number = 1.5
): Promise<Array<Order & { distance_to_driver_km: number }>> {
  const result: Array<Order & { distance_to_driver_km: number }> = [];

  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT *,
          ST_Y(pickup_geog::geometry) as pickup_lat,
          ST_X(pickup_geog::geometry) as pickup_lng,
          ST_Y(dropoff_geog::geometry) as dropoff_lat,
          ST_X(dropoff_geog::geometry) as dropoff_lng,
          (ST_Distance(pickup_geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0) as distance_to_driver_km
        FROM orders
        WHERE status = 'dispatching'
          AND pickup_geog IS NOT NULL
          AND ST_DWithin(pickup_geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3 * 1000)
        ORDER BY distance_to_driver_km ASC;
      `;
      const res = await query<Order & { distance_to_driver_km: number }>(sql, [lng, lat, radiusKm]);
      if (res.rows.length > 0) {
        return res.rows.map(r => ({
          ...r,
          distance_to_driver_km: Number(Number(r.distance_to_driver_km).toFixed(2)),
        }));
      }
    } catch (err: any) {
      console.warn('[Orders DB] 附近訂單空間查詢失敗，使用記憶體空間計算:', err.message);
    }
  }

  // 記憶體備援空間計算 (Haversine Formula)
  for (const order of memoryOrders.values()) {
    if (order.status === 'dispatching' && order.pickup_lat && order.pickup_lng) {
      const pLat = Number(order.pickup_lat);
      const pLng = Number(order.pickup_lng);
      // Haversine
      const R = 6371; // km
      const dLat = (pLat - lat) * (Math.PI / 180);
      const dLng = (pLng - lng) * (Math.PI / 180);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat * (Math.PI / 180)) *
          Math.cos(pLat * (Math.PI / 180)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dist = R * c;

      if (dist <= radiusKm) {
        result.push({
          ...order,
          distance_to_driver_km: Number(dist.toFixed(2)),
        });
      }
    }
  }

  return result.sort((a, b) => a.distance_to_driver_km - b.distance_to_driver_km);
}

/**
 * 查詢指定司機的過往歷史訂單 (上限 20 筆)
 * 支援傳入 LINE User ID、車牌號碼 (如 CEQ-7710)、姓名 (如 Mike Wang) 或電話
 */
export async function getOrdersByDriverId(driverId: string, limit: number = 20): Promise<Order[]> {
  const searchIds = new Set<string>([driverId]);
  try {
    const driverPromise = (async () => {
      return (await getDriverById(driverId)) || (await findDriverByPhoneOrPlate(driverId));
    })();
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 800));
    const driver = await Promise.race([driverPromise, timeoutPromise]);
    if (driver) {
      if (driver.line_user_id) searchIds.add(driver.line_user_id);
      if (driver.plate_number) searchIds.add(driver.plate_number);
      if (driver.display_name) searchIds.add(driver.display_name);
    }
  } catch {}

  const idsArray = Array.from(searchIds);

  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT *,
          ST_Y(pickup_geog::geometry) as pickup_lat,
          ST_X(pickup_geog::geometry) as pickup_lng,
          ST_Y(dropoff_geog::geometry) as dropoff_lat,
          ST_X(dropoff_geog::geometry) as dropoff_lng
        FROM orders
        WHERE driver_id = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT $2;
      `;
      const res = await query<Order>(sql, [idsArray, limit]);
      return res.rows;
    } catch {
      // fallback
    }
  }

  const list: Order[] = [];
  for (const o of memoryOrders.values()) {
    if (o.driver_id && searchIds.has(o.driver_id)) {
      list.push(o);
    }
  }
  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
}
