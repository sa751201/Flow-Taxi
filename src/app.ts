import express from 'express';
import { env } from './config/env.js';
import { DispatchEngine } from './services/dispatch-engine.js';
import { getOrderById } from './db/queries/orders.js';
import { getBidsByOrderId } from './db/queries/bids.js';

import { middleware, webhook } from '@line/bot-sdk';
import { handleLineEvents } from './handlers/line-webhook.js';

const app = express();

export const dispatchEngine = new DispatchEngine();

// 1. LINE Webhook 專用端點 (必須在 express.json() 之前，因為 line middleware 需要 raw body 進行驗簽)
const lineConfig = {
  channelSecret: env.LINE_CHANNEL_SECRET || '',
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
};

app.post('/webhook', middleware(lineConfig), async (req, res) => {
  try {
    const body = req.body as webhook.CallbackRequest;
    // 非同步處理事件，立即回應 200 給 LINE (避免 LINE webhook 逾時)
    handleLineEvents(body.events || []).catch((err) => {
      console.error('[LINE Webhook Error]', err);
    });
    return res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    console.error('[LINE Webhook Handler Error]', err);
    return res.status(500).end();
  }
});

// 其餘路由使用標準 JSON 解析
app.use(express.json());

// 靜態資源服務 (LIFF 頁面、CSS、JS)
app.use(express.static('public'));

// 路由轉發：/driver/register 導向 /driver/register.html
app.get('/driver/register', (req, res) => {
  res.sendFile('public/driver/register.html', { root: process.cwd() });
});

// 提供前端 LIFF 設定
app.get('/api/config', (req, res) => {
  res.json({ liffId: env.LIFF_ID || '' });
});

// 司機資料登記 API
import { upsertDriver, getDriverById as getDriverProfile } from './db/queries/drivers.js';

app.get('/api/driver/:userId', async (req, res) => {
  try {
    const driver = await getDriverProfile(req.params.userId);
    res.json(driver);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/driver/register', async (req, res) => {
  try {
    const { userId, displayName, plateNumber, carColor, carBrand, phone } = req.body;
    if (!userId || !displayName || !plateNumber || !carColor || !carBrand) {
      return res.status(400).json({ error: '請填妥所有必要欄位' });
    }

    const driver = await upsertDriver({
      line_user_id: userId,
      display_name: displayName,
      plate_number: plateNumber,
      car_color: carColor,
      car_brand: carBrand,
      phone: phone || null,
      registered: true,
      status: 'active',
    });

    console.log(`[Driver API] 司機 ${userId} 透過 LIFF 完成登記！`);
    res.json({ success: true, driver });
  } catch (err: any) {
    console.error('[Driver API Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 取得訂單目前狀態與投標列表 (供測試與監控)
app.get('/api/orders/:orderId/dispatch-status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const bids = await getBidsByOrderId(orderId);
    res.json({
      orderId: order.id,
      status: order.status,
      driver_id: order.driver_id,
      bidsCount: bids.length,
      bids,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 觸發提早結算視窗 (供測試/手動排程)
app.post('/api/orders/:orderId/close-window', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await dispatchEngine.closeDispatchWindow(orderId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    console.log(`[Server] Taxi dispatch system listening on port ${env.PORT}`);
  });
}

export default app;
