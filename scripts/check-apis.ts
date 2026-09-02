import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import IORedis from 'ioredis';

const envConfig = dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), '.env')));

async function checkAll() {
  console.log('🔍 開始檢查 .env 中的所有 API 與連線設定...\n');

  // 1. 檢查 LINE Messaging API Token
  console.log('1️⃣ 【LINE Messaging API】');
  const lineToken = envConfig.LINE_CHANNEL_ACCESS_TOKEN;
  if (!lineToken) {
    console.log('   ⚠️ 未設定 LINE_CHANNEL_ACCESS_TOKEN\n');
  } else {
    try {
      const res = await fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${lineToken}` },
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`   ✅ LINE Token 正常！Bot 名稱: ${(data as any).displayName}, 帳號 ID: ${(data as any).basicId}\n`);
      } else {
        console.log(`   ❌ LINE Token 驗證失敗:`, data, '\n');
      }
    } catch (e: any) {
      console.log(`   ❌ LINE API 呼叫失敗:`, e.message, '\n');
    }
  }

  // 2. 檢查 Supabase
  console.log('2️⃣ 【Supabase】');
  const supabaseUrl = envConfig.SUPABASE_URL;
  const supabaseKey = envConfig.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log('   ⚠️ 未設定 SUPABASE_URL 或 SUPABASE_SERVICE_KEY\n');
  } else {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      if (res.ok) {
        console.log(`   ✅ Supabase API 連線正常！\n`);
      } else {
        const text = await res.text();
        console.log(`   ❌ Supabase 回應異常 (${res.status}):`, text, '\n');
      }
    } catch (e: any) {
      console.log(`   ❌ Supabase 連線失敗:`, e.message, '\n');
    }
  }

  // 3. 檢查 Anthropic Claude API
  console.log('3️⃣ 【Claude API (Anthropic)】');
  const anthropicKey = envConfig.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.log('   ⚠️ 未設定 ANTHROPIC_API_KEY\n');
  } else {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`   ✅ Claude API 正常可運行！模型回應成功。\n`);
      } else {
        console.log(`   ❌ Claude API 失敗:`, (data as any).error?.message || data, '\n');
      }
    } catch (e: any) {
      console.log(`   ❌ Claude API 呼叫失敗:`, e.message, '\n');
    }
  }

  // 4. 檢查 Google Maps Geocoding API
  console.log('4️⃣ 【Google Maps Geocoding API】');
  const googleKey = envConfig.GOOGLE_MAPS_API_KEY;
  if (!googleKey) {
    console.log('   ⚠️ 未設定 GOOGLE_MAPS_API_KEY\n');
  } else {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=台北車站&key=${googleKey}`;
      const res = await fetch(url);
      const data = (await res.json()) as any;
      if (data.status === 'OK') {
        const loc = data.results[0]?.geometry?.location;
        console.log(`   ✅ Google Geocoding 正常！台北車站座標: ${loc?.lat}, ${loc?.lng}\n`);
      } else {
        console.log(`   ❌ Google Maps 回應狀態: ${data.status}, 錯誤訊息: ${data.error_message || '無'}\n`);
      }
    } catch (e: any) {
      console.log(`   ❌ Google Maps 呼叫失敗:`, e.message, '\n');
    }
  }

  // 5. 檢查 Redis 真實連線 (PING)
  console.log('5️⃣ 【Redis 連線測試】');
  const redisUrl = envConfig.REDIS_URL;
  if (!redisUrl) {
    console.log('   ⚠️ 未設定 REDIS_URL\n');
  } else {
    const Redis = (IORedis as any).default || IORedis;
    const redis = new Redis(redisUrl, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    });
    try {
      const pingResult = await redis.ping();
      console.log(`   ✅ Redis 公開連線成功！PING 回應: ${pingResult}\n`);
    } catch (err: any) {
      console.log(`   ❌ Redis 連線失敗: ${err.message}\n`);
    } finally {
      redis.disconnect();
    }
  }
}

checkAll().catch(console.error);
