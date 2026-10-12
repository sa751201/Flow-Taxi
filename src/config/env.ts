import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // LINE
  LINE_CHANNEL_SECRET: z.string().optional().default(''),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional().default(''),
  LIFF_ID: z.string().optional().default(''),
  DRIVER_GROUP_ID: z.string().optional().default('C5179346ac8b2f3312cabe051ca818355'),
  ADMIN_GROUP_ID: z.string().optional().default(''),
  DAILY_REPORT_TIME: z.string().optional().default('23:00'), // 格式 HH:mm，預設每晚 23:00
  DRIVER_RICH_MENU_ID: z.string().optional().default('richmenu-ba11011f94290fc2d2b2d28aa0a93916'), // 司機專屬圖文選單 ID
  PASSENGER_RICH_MENU_ID: z.string().optional().default(''), // 乘客預設圖文選單 ID
  OFFICIAL_ACCOUNT_URL: z.string().optional().default('https://line.me/R/ti/p/@688muuaw'), // 1:1 OA 連結 (目前為 TAXI測試MAPI，未來可換回福露 https://lin.ee/AOp42u7)

  // Database / Supabase
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_SERVICE_KEY: z.string().optional().default(''),

  // Claude & Google
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(''),

  // Redis
  REDIS_URL: z.string().optional().default('redis://localhost:6379'),

  // Business Parameters
  DISPATCH_WINDOW_SECONDS: z.coerce.number().default(60),
  NO_DRIVER_EXPAND_SECONDS: z.coerce.number().default(30),

  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
