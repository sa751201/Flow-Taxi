import { query } from '../index.js';
import { env } from '../../config/env.js';

export interface RegularCustomerRoute {
  id: string;
  customer_id?: string | null;
  customer_name: string;
  pickup_address: string;
  dropoff_address: string;
  fixed_fare: number;
  fixed_route: string;
  note?: string | null;
  created_at: Date;
  updated_at?: Date;
}

export interface UpsertRegularCustomerParams {
  id?: string;
  customer_id?: string | null;
  customer_name: string;
  pickup_address: string;
  dropoff_address: string;
  fixed_fare: number;
  fixed_route?: string | null;
  note?: string | null;
}

// 記憶體備援快取（確保無資料庫或連線異常時常客設定依然即時生效）
export const memoryRegularCustomers = new Map<string, RegularCustomerRoute>();

let tableInitialized = false;

async function ensureRegularCustomersTable(): Promise<void> {
  if (tableInitialized || !env.DATABASE_URL) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS regular_customers (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        customer_name TEXT NOT NULL,
        pickup_address TEXT NOT NULL,
        dropoff_address TEXT NOT NULL,
        fixed_fare INTEGER NOT NULL,
        fixed_route TEXT NOT NULL DEFAULT '',
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    tableInitialized = true;
  } catch (err: any) {
    console.warn('[RegularCustomers DB] 自動建立 regular_customers 資料表失敗，使用記憶體備援:', err.message);
  }
}

/**
 * 標準化地點字串以供精準比對：
 * - 去除前後與多餘空白
 * - 統一「臺」為「台」
 * - 全形英數轉半形、轉小寫
 */
export function normalizeAddressForMatch(address?: string | null): string {
  if (!address) return '';
  return address
    .trim()
    .replace(/[\s\u3000]+/g, '')
    .replace(/臺/g, '台')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/**
 * 列出所有常客固定路線與固定金額設定
 */
export async function listRegularCustomers(): Promise<RegularCustomerRoute[]> {
  if (env.DATABASE_URL) {
    try {
      await ensureRegularCustomersTable();
      const res = await query<RegularCustomerRoute>(
        `SELECT * FROM regular_customers ORDER BY created_at DESC;`
      );
      for (const row of res.rows) {
        memoryRegularCustomers.set(row.id, {
          ...row,
          fixed_fare: Number(row.fixed_fare),
        });
      }
      return res.rows.map((r) => ({
        ...r,
        fixed_fare: Number(r.fixed_fare),
      }));
    } catch (err: any) {
      console.warn('[RegularCustomers DB] 讀取常客清單失敗，改用記憶體快取:', err.message);
    }
  }

  return Array.from(memoryRegularCustomers.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * 新增常客固定路線設定
 */
export async function createRegularCustomer(
  params: UpsertRegularCustomerParams
): Promise<RegularCustomerRoute> {
  const id =
    params.id?.trim() ||
    `reg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const customerId = params.customer_id?.trim() || null;
  const customerName = params.customer_name.trim() || '常客';
  const pickupAddress = params.pickup_address.trim();
  const dropoffAddress = params.dropoff_address.trim();
  const fixedFare = Math.round(Number(params.fixed_fare));
  const fixedRoute = (params.fixed_route || '').trim();
  const note = params.note?.trim() || null;
  const now = new Date();

  const record: RegularCustomerRoute = {
    id,
    customer_id: customerId,
    customer_name: customerName,
    pickup_address: pickupAddress,
    dropoff_address: dropoffAddress,
    fixed_fare: fixedFare,
    fixed_route: fixedRoute,
    note,
    created_at: now,
    updated_at: now,
  };

  if (env.DATABASE_URL) {
    try {
      await ensureRegularCustomersTable();
      const res = await query<RegularCustomerRoute>(
        `INSERT INTO regular_customers (
          id, customer_id, customer_name, pickup_address, dropoff_address, fixed_fare, fixed_route, note, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
        ON CONFLICT (id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id,
          customer_name = EXCLUDED.customer_name,
          pickup_address = EXCLUDED.pickup_address,
          dropoff_address = EXCLUDED.dropoff_address,
          fixed_fare = EXCLUDED.fixed_fare,
          fixed_route = EXCLUDED.fixed_route,
          note = EXCLUDED.note,
          updated_at = now()
        RETURNING *;`,
        [id, customerId, customerName, pickupAddress, dropoffAddress, fixedFare, fixedRoute, note]
      );
      if (res.rows[0]) {
        const saved = { ...res.rows[0], fixed_fare: Number(res.rows[0].fixed_fare) };
        memoryRegularCustomers.set(saved.id, saved);
        return saved;
      }
    } catch (err: any) {
      console.warn('[RegularCustomers DB] 寫入常客設定失敗，存入記憶體備援:', err.message);
    }
  }

  memoryRegularCustomers.set(id, record);
  return record;
}

/**
 * 更新常客固定路線設定
 */
export async function updateRegularCustomer(
  id: string,
  params: Partial<UpsertRegularCustomerParams>
): Promise<RegularCustomerRoute | null> {
  const all = await listRegularCustomers();
  const existing = all.find((item) => item.id === id) || memoryRegularCustomers.get(id);
  if (!existing) return null;

  return createRegularCustomer({
    id,
    customer_id: params.customer_id !== undefined ? params.customer_id : existing.customer_id,
    customer_name: params.customer_name !== undefined ? params.customer_name : existing.customer_name,
    pickup_address: params.pickup_address !== undefined ? params.pickup_address : existing.pickup_address,
    dropoff_address: params.dropoff_address !== undefined ? params.dropoff_address : existing.dropoff_address,
    fixed_fare: params.fixed_fare !== undefined ? Number(params.fixed_fare) : existing.fixed_fare,
    fixed_route: params.fixed_route !== undefined ? params.fixed_route : existing.fixed_route,
    note: params.note !== undefined ? params.note : existing.note,
  });
}

/**
 * 刪除常客固定路線設定
 */
export async function deleteRegularCustomer(id: string): Promise<boolean> {
  let deleted = memoryRegularCustomers.delete(id);

  if (env.DATABASE_URL) {
    try {
      await ensureRegularCustomersTable();
      const res = await query(
        `DELETE FROM regular_customers WHERE id = $1 RETURNING id;`,
        [id]
      );
      if ((res.rowCount ?? 0) > 0) {
        deleted = true;
      }
    } catch (err: any) {
      console.warn('[RegularCustomers DB] 刪除常客設定失敗:', err.message);
    }
  }

  return deleted;
}

/**
 * 當客人叫車時判斷上下車地點：
 * - 如果上車地點與下車地點皆與設定相符（且若設定有指定 customer_id 則須相符），回傳該常客之固定金額與固定路線。
 * - 當這個客人上下車地點有任一不符合時，回傳 null（由呼叫端以正常費率計算）。
 */
export async function matchRegularCustomerRoute(params: {
  customerId?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
}): Promise<RegularCustomerRoute | null> {
  const normPickup = normalizeAddressForMatch(params.pickupAddress);
  const normDropoff = normalizeAddressForMatch(params.dropoffAddress);

  // 上車或下車任一未填寫，則不可能同時符合固定上下車地點
  if (!normPickup || !normDropoff) {
    return null;
  }

  const rules = await listRegularCustomers();
  if (rules.length === 0) return null;

  const cleanCustomerId = params.customerId?.trim() || '';

  // 1. 優先比對有綁定該特定 customer_id 且上下車地點皆完全相符之常客設定
  if (cleanCustomerId) {
    const exactCustomerMatch = rules.find((rule) => {
      if (!rule.customer_id || rule.customer_id.trim() !== cleanCustomerId) return false;
      const rulePickup = normalizeAddressForMatch(rule.pickup_address);
      const ruleDropoff = normalizeAddressForMatch(rule.dropoff_address);
      return Boolean(rulePickup && ruleDropoff && rulePickup === normPickup && ruleDropoff === normDropoff);
    });
    if (exactCustomerMatch) {
      return exactCustomerMatch;
    }
  }

  // 2. 次優先比對未限定特定 LINE User ID（或以通用固定點對點常客規則設定）且上下車地點皆相符之設定
  const generalMatch = rules.find((rule) => {
    if (rule.customer_id && rule.customer_id.trim() !== '' && rule.customer_id.trim() !== cleanCustomerId) {
      return false;
    }
    const rulePickup = normalizeAddressForMatch(rule.pickup_address);
    const ruleDropoff = normalizeAddressForMatch(rule.dropoff_address);
    return Boolean(rulePickup && ruleDropoff && rulePickup === normPickup && ruleDropoff === normDropoff);
  });

  return generalMatch || null;
}

