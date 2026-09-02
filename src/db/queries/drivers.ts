import { query } from '../index.js';

export interface Driver {
  line_user_id: string;
  display_name: string | null;
  phone: string | null;
  plate_number: string | null;
  car_color: string | null;
  car_brand: string | null;
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
  status?: 'inactive' | 'active' | 'online';
  registered?: boolean;
}

export async function upsertDriver(params: UpsertDriverParams): Promise<Driver> {
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
}

export async function getDriverById(lineUserId: string): Promise<Driver | null> {
  const sql = 'SELECT * FROM drivers WHERE line_user_id = $1';
  const res = await query<Driver>(sql, [lineUserId]);
  return res.rows[0] || null;
}
