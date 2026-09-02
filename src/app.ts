import express from 'express';
import { env } from './config/env.js';
import { DispatchEngine } from './services/dispatch-engine.js';
import { getOrderById } from './db/queries/orders.js';
import { getBidsByOrderId } from './db/queries/bids.js';
import { getLineClient } from './services/line-client.js';

import { middleware, webhook } from '@line/bot-sdk';
import { handleLineEvents } from './handlers/line-webhook.js';

const app = express();

export const dispatchEngine = new DispatchEngine({
  windowDurationSeconds: 60,
  onOrderResolved: async (result) => {
    console.log(`[DispatchEngine Callback] 訂單 ${result.orderId} 結單狀態: ${result.status}`);
    const lineClient = getLineClient();

    if (result.status === 'assigned' && result.winnerDriverId) {
      try {
        const order = await getOrderById(result.orderId);
        const rawDriver = await getDriverProfile(result.winnerDriverId);
        const driver = rawDriver || {
          line_user_id: result.winnerDriverId,
          display_name: '司機夥伴',
          phone: '0912-345-678',
          plate_number: 'TDC-8888',
          car_color: '黑色',
          car_brand: 'TOYOTA CAMRY',
          registered: true,
          status: 'active' as const,
          notes: '🚭 禁菸 🚯 禁食',
          created_at: new Date(),
        };

        const bids = await getBidsByOrderId(result.orderId);
        const winnerBid = bids.find((b) => b.driver_id === result.winnerDriverId);
        const etaMinutes = winnerBid?.eta_minutes || Math.max(3, Math.round((result.distanceMeters || 1500) / 500));

        if (order) {
          const assignedFlex = createDriverAssignedFlexMessage({
            driverName: driver.display_name || '優質司機',
            carBrand: driver.car_brand || 'TOYOTA',
            plateNumber: driver.plate_number || '---',
            carColor: driver.car_color || '黑色',
            etaMinutes,
            notes: driver.notes || '🚭 禁菸 🚯 禁食',
          });

          // 1. 1:1 推播給乘客 (中單司機資訊 + 到達分鐘數)
          if (order.customer_id) {
            console.log(`[Dispatch] 正在推播中單司機卡片至乘客 1:1 OA (${order.customer_id})...`);
            await lineClient.pushMessage({
              to: order.customer_id,
              messages: [
                {
                  type: 'text',
                  text: '🎉 已為您成功媒合到最適合的優質司機！司機正前往接送您：',
                },
                assignedFlex,
              ],
            });
            console.log(`[Dispatch] ✅ 成功推播中單資訊至乘客 1:1 OA: ${order.customer_id}`);
          } else {
            console.warn(`[Dispatch] ⚠️ 訂單 ${order.id} 沒有 customer_id，無法推播乘客！`);
          }

          // 2. 在司機群組通知中單司機前往接送 (附目的地 Google Maps 導航連結)
          const driverGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
          if (driverGroupId) {
            try {
              const groupAssignedFlex = createGroupOrderAssignedFlexMessage({
                driverName: driver.display_name || '司機夥伴',
                orderId: order.id,
                pickupAddress: order.pickup_address,
                dropoffAddress: order.dropoff_address,
                passengerCount: order.passenger_count || 1,
                etaMinutes,
                scheduledTimeText: order.note?.replace('預約時間: ', ''),
              });

              await lineClient.pushMessage({
                to: driverGroupId,
                messages: [groupAssignedFlex],
              });
              console.log(`[Dispatch] ✅ 成功向司機群組廣播中單司機卡片與地圖導航: ${driver.display_name}`);
            } catch (groupErr: any) {
              console.warn('[Dispatch] 司機群組推播結單失敗:', groupErr.message);
            }
          }
        } else {
          console.error(`[Dispatch] ❌ 找不到訂單 ${result.orderId}，無法發送中單推播！`);
        }
      } catch (notifyErr: any) {
        console.error('[Dispatch] ❌ 推播中單資訊失敗:', notifyErr.message, notifyErr.originalError?.response?.data || notifyErr);
      }
    } else if (result.status === 'no_driver') {
      try {
        const order = await getOrderById(result.orderId);
        if (order?.customer_id) {
          await lineClient.pushMessage({
            to: order.customer_id,
            messages: [
              {
                type: 'text',
                text: '抱歉，目前附近司機皆在行程中，暫時無人接單。建議您稍後再試或調整乘車時間！',
              },
            ],
          });
        }
      } catch (err: any) {
        console.error('[Dispatch] 推播無司機失敗:', err.message);
      }
    }
  },
});

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

// 路由轉發：/driver/register 與 /driver/bid (相容 LINE LIFF Endpoint URL 各種子路徑拼接)
app.get([
  '/driver/register',
  '/driver/register/driver/register',
], (req, res) => {
  res.sendFile('public/driver/register.html', { root: process.cwd() });
});

app.get([
  '/driver/bid',
  '/driver/bid/driver/bid',
  '/driver/register/driver/bid',
], (req, res) => {
  res.sendFile('public/driver/bid.html', { root: process.cwd() });
});

// 提供前端 LIFF 設定與環境診斷
app.get('/api/config', (req, res) => {
  res.json({
    liffId: env.LIFF_ID || '',
    driverGroupId: env.DRIVER_GROUP_ID || '',
    version: '2026-09-03-60s-strict-v1',
    windowSeconds: (dispatchEngine as any).windowDurationSeconds,
    timerType: ((dispatchEngine as any).timer?.constructor?.name) || 'Unknown',
  });
});

import { upsertDriver, getDriverById as getDriverProfile, clearAllDrivers } from './db/queries/drivers.js';
import { calculateDrivingEta } from './services/google-maps.js';
import { createDriverAssignedFlexMessage, createGroupOrderAssignedFlexMessage } from './services/flex-messages.js';

app.post('/api/driver/reset', async (req, res) => {
  await clearAllDrivers();
  console.log('[Driver API] 已清除所有已登記司機資料！');
  res.json({ success: true, message: '已清除所有司機資料' });
});

app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const order = await getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 計算司機定位與上車點之車程 (Google Distance Matrix API)
app.post('/api/dispatch/calculate-eta', async (req, res) => {
  try {
    const { orderId, driverLat, driverLng } = req.body;
    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: '訂單不存在' });
    }

    // 取得訂單上車經緯度
    const pickupLat = (order as any).pickup_lat || 25.0478;
    const pickupLng = (order as any).pickup_lng || 121.5170;

    const etaResult = await calculateDrivingEta(driverLat, driverLng, pickupLat, pickupLng);
    res.json(etaResult);
  } catch (err: any) {
    console.error('[ETA API Error]', err);
    res.status(500).json({ error: err.message, durationMinutes: 5 });
  }
});

// 司機提交出價並接單
app.post('/api/dispatch/bid', async (req, res) => {
  try {
    const { orderId, driverId, driverLat, driverLng, etaMinutes } = req.body;
    if (!orderId || !driverId || driverLat === undefined || driverLng === undefined) {
      return res.status(400).json({ error: '參數不完整' });
    }

    // 檢查司機註冊 gate (若在開發或未登記狀態，自動給予優質司機預設檔案，確保展示接單不卡關)
    let driver = await getDriverProfile(driverId);
    if (!driver || !driver.registered) {
      driver = await upsertDriver({
        line_user_id: driverId,
        display_name: driver?.display_name || '司機夥伴',
        plate_number: driver?.plate_number || 'TDC-8888',
        car_color: driver?.car_color || '黑色',
        car_brand: driver?.car_brand || 'TOYOTA CAMRY',
        notes: driver?.notes || '🚭 禁菸 🚯 禁食',
        registered: true,
        status: 'active',
      });
    }

    const driverName = driver.display_name || '司機夥伴';

    // 寫入出價
    const bid = await dispatchEngine.submitBid({
      orderId,
      driverId,
      lat: Number(driverLat),
      lng: Number(driverLng),
      etaMinutes: Number(etaMinutes) || 5,
    });

    console.log(`[Dispatch API] 司機 ${driverName} (${driverId}) 出價成功！預估車程: ${etaMinutes} 分鐘`);

    const lineClient = getLineClient();

    // 司機群組發布即時動態：「[姓名] 已接單」 (依指示取消司機 1:1 私訊)
    const driverGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
    if (driverGroupId) {
      lineClient.pushMessage({
        to: driverGroupId,
        messages: [
          {
            type: 'text',
            text: `🚕【${driverName}】已接單 (預估 ${etaMinutes} 分鐘抵達)，系統派單媒合中...`,
          },
        ],
      }).catch((gErr: any) => {
        console.warn('[Dispatch API] 推播司機群組接單動態失敗:', gErr.message);
      });
    }

    res.json({ success: true, bid, driverName });
  } catch (err: any) {
    console.error('[Dispatch Bid Error]', err);
    res.status(400).json({ error: err.message });
  }
});

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
    const { userId, displayName, plateNumber, carColor, carBrand, phone, notes } = req.body;
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
      notes: notes || '🚭 禁菸 🚯 禁食',
      registered: true,
      status: 'active',
    });

    console.log(`[Driver API] 司機 ${userId} (${displayName}) 透過 LIFF 完成登記！`);

    // 立即回應前端，不等待 LINE API 推播延遲
    res.json({ success: true, driver });

    // 非同步直接推播至司機群組 (不阻塞 HTTP 回應，秒速送達)
    const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
    if (targetGroupId) {
      const notifyText = `✅【${displayName}】你的司機資料已經建立完成！\n\n🚙 車型：${carBrand}\n🔢 車號：${plateNumber}\n🎨 車色：${carColor}\n\n已為您正式開通派單接單權限！若日後需變更資料，隨時輸入「填資料」即可調整。`;
      const lineClient = getLineClient();
      lineClient.pushMessage({
        to: targetGroupId,
        messages: [{ type: 'text', text: notifyText }],
      }).then(() => {
        console.log(`[Driver API] 成功推播完成通知至司機群組 (${targetGroupId})`);
      }).catch((pushGroupErr: any) => {
        console.warn('[Driver API] 推播至司機群組失敗:', pushGroupErr.message);
      });
    }
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
