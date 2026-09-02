import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // LINE
  LINE_CHANNEL_SECRET: z.string().optional().default(''),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional().default(''),
  LIFF_ID: z.string().optional().default(''),
  DRIVER_GROUP_ID: z.string().optional().default(''),

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
