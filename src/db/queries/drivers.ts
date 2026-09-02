import { env } from '../../config/env.js';
import { query } from '../index.js';

export interface Driver {
  line_user_id: string;
  display_name: string | null;
  phone: string | null;
  plate_number: string | null;
  car_color: string | null;
  car_brand: string | null;
  notes?: string | null;
  status: 'inactive' | 'active' | 'online';
  registered: boolean;
  created_at: Date;
}

export interface UpsertDriverParams {
  line_user_id: string;
  display_name?: string | null;
  phone?: string | null;
  plate_number?: string | null;
  car_color?: string | null;
  car_brand?: string | null;
  notes?: string | null;
  status?: 'inactive' | 'active' | 'online';
  registered?: boolean;
}

// 記憶體備援快取 (當 DATABASE_URL 未設定或 DB 連線異常時使用，保障原型與展示不中斷)
const memoryDrivers = new Map<string, Driver>();

export async function upsertDriver(params: UpsertDriverParams): Promise<Driver> {
  // 1. 若有設定 DATABASE_URL 嘗試寫入 PostgreSQL
  if (env.DATABASE_URL) {
    try {
      const sql = `
        INSERT INTO drivers (
          line_user_id,
          display_name,
          phone,
          plate_number,
          car_color,
          car_brand,
          status,
          registered
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          COALESCE($7, 'active'),
          COALESCE($8, true)
        )
        ON CONFLICT (line_user_id)
        DO UPDATE SET
          display_name = COALESCE(EXCLUDED.display_name, drivers.display_name),
          phone = COALESCE(EXCLUDED.phone, drivers.phone),
          plate_number = COALESCE(EXCLUDED.plate_number, drivers.plate_number),
          car_color = COALESCE(EXCLUDED.car_color, drivers.car_color),
          car_brand = COALESCE(EXCLUDED.car_brand, drivers.car_brand),
          registered = true,
          status = 'active'
        RETURNING *;
      `;

      const values = [
        params.line_user_id,
        params.display_name || null,
        params.phone || null,
        params.plate_number || null,
        params.car_color || null,
        params.car_brand || null,
        params.status || 'active',
        params.registered ?? true,
      ];

      const res = await query<Driver>(sql, values);
      return res.rows[0];
    } catch (dbErr: any) {
      console.warn('[DB] PostgreSQL 寫入失敗，切換至備援存儲:', dbErr.message);
    }
  }

  // 2. 備援存儲 / REST API 寫入
  const existing = memoryDrivers.get(params.line_user_id);
  const updatedDriver: Driver = {
    line_user_id: params.line_user_id,
    display_name: params.display_name ?? existing?.display_name ?? null,
    phone: params.phone ?? existing?.phone ?? null,
    plate_number: params.plate_number ?? existing?.plate_number ?? null,
    car_color: params.car_color ?? existing?.car_color ?? null,
    car_brand: params.car_brand ?? existing?.car_brand ?? null,
    notes: params.notes ?? existing?.notes ?? '🚭 禁菸 🚯 禁食',
    status: (params.status || existing?.status || 'active') as any,
    registered: true,
    created_at: existing?.created_at || new Date(),
  };

  memoryDrivers.set(params.line_user_id, updatedDriver);

  // 嘗試透過 Supabase REST API 寫入 (若已在 Supabase 執行 schema.sql)
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/drivers`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(updatedDriver),
      });
    } catch {
      // ignore
    }
  }

  return updatedDriver;
}

export async function getDriverById(lineUserId: string): Promise<Driver | null> {
  if (env.DATABASE_URL) {
    try {
      const sql = 'SELECT * FROM drivers WHERE line_user_id = $1';
      const res = await query<Driver>(sql, [lineUserId]);
      if (res.rows[0]) return res.rows[0];
    } catch {
      // fallback to memory
    }
  }

  return memoryDrivers.get(lineUserId) || null;
}

export async function clearAllDrivers(): Promise<void> {
  memoryDrivers.clear();
  if (env.DATABASE_URL) {
    try {
      await query('DELETE FROM drivers;');
    } catch {
      // ignore
    }
  }
}
