import fs from 'fs';
import path from 'path';
import { getLineClient } from '../src/services/line-client.js';
import { env } from '../src/config/env.js';

const APP_URL = 'https://flow-taxi-production.up.railway.app/driver/app';
const IMAGE_PATH = path.resolve(process.cwd(), 'assets/driver-rich-menu.png');

async function main() {
  console.log('🚀 開始設定司機專屬圖文選單 (Rich Menu)...');

  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('未設定 LINE_CHANNEL_ACCESS_TOKEN！請先在 .env 設定。');
  }

  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`找不到圖文選單圖片：${IMAGE_PATH}`);
  }

  const client = getLineClient();

  // 1. 列出目前的 Rich Menus
  const existingMenus = await client.getRichMenuList();
  console.log(`📋 目前線上現存 ${existingMenus.richmenus.length} 個圖文選單`);

  for (const m of existingMenus.richmenus) {
    console.log(`- [${m.richMenuId}] ${m.name} (${m.size.width}x${m.size.height})`);
  }

  // 2. 建立新版 Rich Menu 結構
  // 圖片尺寸 2500 x 843
  // 左側 2/3 (x: 0 ~ 1667): 「開啟接單程式」按鈕，連結至 APP_URL
  // 右側 1/3 (x: 1667 ~ 2500): 使用者指示「右方的暫時不設定」，不設點擊區域
  const richMenuPayload = {
    size: {
      width: 2500,
      height: 843,
    },
    selected: true,
    name: '司機接單工作台 (開啟接單程式)',
    chatBarText: '🚕 司機接單工作台',
    areas: [
      {
        bounds: {
          x: 0,
          y: 0,
          width: 1667,
          height: 843,
        },
        action: {
          type: 'uri' as const,
          label: '開啟接單程式',
          uri: APP_URL,
        },
      },
    ],
  };

  console.log('⏳ 正在向 LINE API 建立圖文選單...');
  const createRes = await client.createRichMenu(richMenuPayload);
  const newRichMenuId = createRes.richMenuId;
  console.log(`✅ 成功建立 Rich Menu ID: ${newRichMenuId}`);

  // 3. 上傳圖片
  console.log(`⏳ 正在上傳圖文選單背景圖片 (${IMAGE_PATH})...`);
  const imageBuffer = fs.readFileSync(IMAGE_PATH);

  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${newRichMenuId}/content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'image/png',
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`上傳圖片至 LINE API 失敗 (${uploadRes.status}): ${errText}`);
  }

  console.log(`🎉 圖片上傳成功！司機專用 Rich Menu 已就緒：${newRichMenuId}`);

  // 4. 更新 .env 中的 DRIVER_RICH_MENU_ID
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf-8');
    if (envContent.includes('DRIVER_RICH_MENU_ID=')) {
      envContent = envContent.replace(/DRIVER_RICH_MENU_ID=.*(\r?\n|$)/g, `DRIVER_RICH_MENU_ID=${newRichMenuId}\n`);
    } else {
      envContent += `\nDRIVER_RICH_MENU_ID=${newRichMenuId}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log(`📝 已自動將 DRIVER_RICH_MENU_ID=${newRichMenuId} 寫入 .env`);
  }

  console.log('\n=============================================');
  console.log(`司機圖文選單 ID: ${newRichMenuId}`);
  console.log(`點擊左側開啟網址: ${APP_URL}`);
  console.log('=============================================\n');
}

main().catch((err) => {
  console.error('❌ 設定失敗:', err);
  process.exit(1);
});
