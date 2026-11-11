import express from 'express';
import { env } from './config/env.js';
import { DispatchEngine } from './services/dispatch-engine.js';
import {
  getOrderById,
  updateOrderDropoffAndDistance,
  updateOrderDestination,
  getNearbyOrders,
  getOrdersByDriverId,
  getActiveOrderByDriverId,
  getScheduledOrdersByDriverId,
  updateOrderStatus,
  markDriverArrived,
  markReservationAwaitingDriverAck,
  getOrderDefaultFare,
  completeOrderWithFare,
  extractFixedRoute,
} from './db/queries/orders.js';
import {
  listRegularCustomers,
  createRegularCustomer,
  updateRegularCustomer,
  deleteRegularCustomer,
  matchRegularCustomerRoute,
} from './db/queries/regular-customers.js';
import { getBidsByOrderId } from './db/queries/bids.js';
import {
  upsertDriver,
  getDriverById as getDriverProfile,
  clearAllDrivers,
  findDriverByPhoneOrPlate,
  addDriverCompensationPoint,
} from './db/queries/drivers.js';
import { getLineClient } from './services/line-client.js';
import { geocodeAddress, calculateDrivingEta, getDrivingRoute, roundUpToFiveMinutes } from './services/google-maps.js';
import { calculateCityFare, calculateHaversineDistance } from './services/fare-calculator.js';
import {
  createDriverAssignedFlexMessage,
  createGroupOrderWonFlexMessage,
  createDriverOrderCardFlexMessage,
  createGroupOrderAssignedFlexMessage,
  createPassengerReservationConfirmedFlexMessage,
  createDriverReservationOrderCardFlexMessage,
  createDriverBoardedFareConfirmFlexMessage,
  createGroupOrderCompletedFlexMessage,
} from './services/flex-messages.js';
import { linkDriverRichMenu } from './services/rich-menu.js';
import { isFutureReservation, formatScheduledTime, extractScheduledTimeText } from './services/reservation.js';
import { endCustomerChatSession } from './services/order-chat.js';
import {
  startReservationReminderWorker,
  registerReservationLifecycleHooks,
  reopenReservationOrder,
} from './services/reservation-reminder.js';
import {
  evaluateShortTripOnCompletion,
  notifyShortTripForVerification,
} from './services/short-trip-verifier.js';

import { middleware, webhook, messagingApi } from '@line/bot-sdk';
import { handleLineEvents } from './handlers/line-webhook.js';
import { initDailyReportScheduler } from './services/daily-reporter.js';
import { loadSilentRulesFromExcel } from './services/silent-questions.js';

const app = express();

export const dispatchEngine = new DispatchEngine({
  windowDurationSeconds: 30,
  onFirstBidder: async (orderId, driverId) => {
    try {
      console.log(`[Dispatch] 收到第一位司機接單 (訂單: ${orderId}, 司機: ${driverId})，立即通知乘客 1:1 OA...`);
      const order = await getOrderById(orderId);
      if (order && order.customer_id) {
        const lineClient = getLineClient();
        await lineClient.pushMessage({
          to: order.customer_id,
          messages: [
            {
              type: 'text',
              text: '🚕 已有司機接單，正在派單媒合中，請稍候約 30 秒確認司機資訊！',
            },
          ],
        });
        console.log(`[Dispatch] ✅ 成功向乘客 1:1 OA (${order.customer_id}) 發送首位司機接單通知`);
      }
    } catch (fbErr: any) {
      console.warn(`[Dispatch] 發送首位司機接單通知至乘客失敗:`, fbErr.message);
    }
  },
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
          notes: '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000',
          created_at: new Date(),
        };

        const bids = await getBidsByOrderId(result.orderId);
        const winnerBid = bids.find((b) => b.driver_id === result.winnerDriverId);
        const driverName = driver.display_name || (winnerBid as any)?.driverName || '優質司機';
        const rawEta = winnerBid?.eta_minutes || Math.max(3, Math.round((result.distanceMeters || 1500) / 500));
        const etaMinutes = winnerBid?.eta_minutes || roundUpToFiveMinutes(rawEta);

        if (order) {
          const isReservation = isFutureReservation(order);
          const scheduledText = extractScheduledTimeText(order) ||
            (order.scheduled_time ? formatScheduledTime(order.scheduled_time) : '');

          if (isReservation) {
            await markReservationAwaitingDriverAck(order.id);
          }

          // 1. 1:1 推播給乘客 (預約單 vs 即時單)
          if (order.customer_id) {
            if (isReservation) {
              const resFlex = createPassengerReservationConfirmedFlexMessage({
                orderId: order.id,
                scheduledTimeText: scheduledText,
                pickupAddress: order.pickup_address,
                dropoffAddress: order.dropoff_address,
                driverName,
                carBrand: driver.car_brand || 'TOYOTA',
                plateNumber: driver.plate_number || '---',
                carColor: driver.car_color || '黑色',
                estimatedFare: order.fare,
              });

              await lineClient.pushMessage({
                to: order.customer_id,
                messages: [
                  {
                    type: 'text',
                    text: `🎉【預約成功】已為您安排優質司機承接您的預約行程！\n📅 預約乘車時間：${scheduledText}\n📍 上車地點：${order.pickup_address}\n\n⏰ 請於約定時間準時搭車，系統將於【用車前 1 小時】再次發送貼心搭車提醒！✨`,
                  },
                  resFlex,
                ],
              });
              console.log(`[Dispatch] ✅ 成功推播預約確認資訊至乘客 1:1 OA: ${order.customer_id}`);
            } else {
              const assignedFlex = createDriverAssignedFlexMessage({
                driverName: driver.display_name || '優質司機',
                carBrand: driver.car_brand || 'TOYOTA',
                plateNumber: driver.plate_number || '---',
                carColor: driver.car_color || '黑色',
                etaMinutes,
                notes: driver.notes || '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000',
              });

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
            }
          } else {
            console.warn(`[Dispatch] ⚠️ 訂單 ${order.id} 沒有 customer_id，無法推播乘客！`);
          }

          // 2. 在司機群組通知中單結果（只提示是誰接到單，下方 ghost button 先透過 LIFF 驗證是否為接單司機，非接單司機彈窗提示未接單）
          const driverGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
          if (driverGroupId) {
            try {
              const checkWonUrl = env.LIFF_ID
                ? `https://liff.line.me/${env.LIFF_ID}/driver/bid?orderId=${order.id}&mode=check_won`
                : `https://flow-taxi-production.up.railway.app/driver/bid?orderId=${order.id}&mode=check_won`;

              const groupWonFlex = createGroupOrderWonFlexMessage({
                driverName,
                orderId: order.id,
                winnerDriverId: result.winnerDriverId,
                checkUrl: checkWonUrl,
                oaUrl: env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw',
                isReservation,
              });

              await lineClient.pushMessage({
                to: driverGroupId,
                messages: [groupWonFlex],
              });
              console.log(`[Dispatch] ✅ 成功向司機群組發送中單提示與開啟 1:1 OA ghost button: ${driverName}`);
            } catch (groupErr: any) {
              console.warn('[Dispatch] 司機群組推播結單失敗:', groupErr.message);
            }
          }

          // 3. 在接單司機與 OA 的 1:1 chat room 呈現確認接單卡片
          if (result.winnerDriverId) {
            try {
              // 接單後切換 1:1 OA 選單為「開啟接單程式」專屬圖文選單
              linkDriverRichMenu(result.winnerDriverId).catch((rmErr: any) => {
                console.warn(`[Dispatch] 為中單司機 ${result.winnerDriverId} 綁定專屬選單失敗:`, rmErr.message);
              });

              if (isReservation) {
                const driverResCard = createDriverReservationOrderCardFlexMessage({
                  orderId: order.id,
                  driverName,
                  scheduledTimeText: scheduledText,
                  pickupAddress: order.pickup_address,
                  dropoffAddress: order.dropoff_address,
                  passengerCount: order.passenger_count || 1,
                  estimatedFare: order.fare,
                });

                await lineClient.pushMessage({
                  to: result.winnerDriverId,
                  messages: [
                    {
                      type: 'text',
                      text: `📅 恭喜您成功承接預約行程！\n乘車時間為 ${scheduledText}。\n⚠️ 請務必於 1 小時內點擊下方卡片的「✅ 我知道了」確認接單（若 1 小時內未按，管理員可重啟此單改派其他司機）。\n確認後，系統將在【出發前 1 小時】於 1:1 OA 發送通知與訂單資訊引導您前往上車地點載客！🚕`,
                    },
                    driverResCard,
                  ],
                });
                console.log(`[Dispatch] ✅ 成功向中單司機 1:1 OA (${result.winnerDriverId}) 推播預約單卡片`);
              } else {
                const driverCardFlex = createDriverOrderCardFlexMessage({
                  driverName,
                  orderId: order.id,
                  pickupAddress: order.pickup_address,
                  dropoffAddress: order.dropoff_address,
                  passengerCount: order.passenger_count || 1,
                  etaMinutes,
                  scheduledTimeText: order.note?.replace('預約時間: ', ''),
                });

                await lineClient.pushMessage({
                  to: result.winnerDriverId,
                  messages: [
                    {
                      type: 'text',
                      text: `🚕 恭喜您成功接單！請前往上車地點接送乘客。\n到達後請點擊卡片下方「我已到達上車點」或直接輸入「到」回報。`,
                    },
                    driverCardFlex,
                  ],
                });
                console.log(`[Dispatch] ✅ 成功向中單司機 1:1 OA (${result.winnerDriverId}) 推播確認接單卡片`);
              }
            } catch (driverDmErr: any) {
              console.warn(`[Dispatch] 向司機 1:1 OA 推播確認卡片失敗 (司機可能尚未加 OA 好友):`, driverDmErr.message);
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

app.get([
  '/driver/short-trip',
  '/driver/short-trip/driver/short-trip',
  '/driver/bid/driver/short-trip',
  '/driver/register/driver/short-trip',
  '/driver/app/driver/short-trip',
], (req, res) => {
  res.sendFile('public/driver/short-trip.html', { root: process.cwd() });
});

app.get([
  '/driver/adjust-fare',
  '/driver/adjust-fare/driver/adjust-fare',
  '/driver/bid/driver/adjust-fare',
  '/driver/register/driver/adjust-fare',
], (req, res) => {
  res.sendFile('public/driver/adjust-fare.html', { root: process.cwd() });
});

// 記憶體 Log 緩衝區 (供除錯查看即時計時器秒數與事件)
const recentLogs: string[] = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: any[]) => {
  const line = `[${new Date().toISOString()}] [LOG] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  recentLogs.push(line);
  if (recentLogs.length > 100) recentLogs.shift();
  originalLog.apply(console, args);
};
console.warn = (...args: any[]) => {
  const line = `[${new Date().toISOString()}] [WARN] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  recentLogs.push(line);
  if (recentLogs.length > 100) recentLogs.shift();
  originalWarn.apply(console, args);
};
console.error = (...args: any[]) => {
  const line = `[${new Date().toISOString()}] [ERROR] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  recentLogs.push(line);
  if (recentLogs.length > 100) recentLogs.shift();
  originalError.apply(console, args);
};

// 路由轉發：/driver/app (司機全螢幕地圖調度中心 PWA)
app.get([
  '/driver/app',
  '/driver/app/driver/app',
  '/driver/bid/driver/app',
  '/driver/register/driver/app',
], (req, res) => {
  res.sendFile('public/driver/app.html', { root: process.cwd() });
});

// 路由轉發：/admin (管理員後台 - 含常客固定路線與固定金額管理頁籤)
app.get([
  '/admin',
  '/admin/regular-customers',
], (req, res) => {
  res.sendFile('public/admin/index.html', { root: process.cwd() });
});

// 提供前端 LIFF 設定與環境診斷
app.get('/api/config', (req, res) => {
  res.json({
    liffId: env.LIFF_ID || '',
    driverGroupId: env.DRIVER_GROUP_ID || '',
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || '',
    oaUrl: env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw',
    dispatchPhone: '02-23456789', // 中控客服專線代撥
    version: '2026-10-pwa-v1',
    windowSeconds: (dispatchEngine as any).windowDurationSeconds,
    timerType: ((dispatchEngine as any).timer?.constructor?.name) || 'Unknown',
  });
});

// 司機網頁版：取得方圓 1.5 公里內正在派單中的訂單
app.get('/api/dispatch/nearby-orders', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = req.query.radiusKm ? Number(req.query.radiusKm) : 1.5;

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: '請提供有效的司機經緯度座標 (lat, lng)' });
    }

    const nearbyOrders = await getNearbyOrders(lat, lng, radiusKm);
    res.json({ success: true, count: nearbyOrders.length, orders: nearbyOrders });
  } catch (err: any) {
    console.error('[Nearby Orders API Error]', err);
    res.status(500).json({ error: err.message, orders: [] });
  }
});

// 司機網頁版：查詢司機當前進行中的任務 (accepted / picked_up)
app.get('/api/driver/:driverId/active-trip', async (req, res) => {
  try {
    const activeOrder = await getActiveOrderByDriverId(req.params.driverId);
    if (!activeOrder) {
      return res.json({ hasActiveTrip: false, order: null });
    }
    const isArrived = activeOrder.status === 'accepted' && (Boolean(activeOrder.note?.includes('[DRIVER_ARRIVED]')) || Boolean((activeOrder as any).driver_arrived));
    const effectiveOrder: any = isArrived ? { ...activeOrder, status: 'arrived', is_arrived: true } : { ...activeOrder };

    // 確保上車地點有正確經緯度
    let pLat = Number(effectiveOrder.pickup_lat);
    let pLng = Number(effectiveOrder.pickup_lng);
    if (!pLat || !pLng || isNaN(pLat) || isNaN(pLng)) {
      if (effectiveOrder.pickup_address) {
        try {
          console.log(`[Active Trip API] 即時解析上車地址座標: "${effectiveOrder.pickup_address}"`);
          const geo = await geocodeAddress(effectiveOrder.pickup_address);
          pLat = geo.lat;
          pLng = geo.lng;
        } catch (e: any) {
          console.warn('[Active Trip API] 解析上車地點失敗:', e.message);
        }
      }
    }
    if (pLat && pLng && !isNaN(pLat) && !isNaN(pLng)) {
      effectiveOrder.pickup_lat = pLat;
      effectiveOrder.pickup_lng = pLng;
    }

    // 確保下車地點有正確經緯度
    let dLat = Number(effectiveOrder.dropoff_lat);
    let dLng = Number(effectiveOrder.dropoff_lng);
    if (!dLat || !dLng || isNaN(dLat) || isNaN(dLng)) {
      if (effectiveOrder.dropoff_address) {
        try {
          console.log(`[Active Trip API] 即時解析下車地址座標: "${effectiveOrder.dropoff_address}"`);
          const geo = await geocodeAddress(effectiveOrder.dropoff_address);
          dLat = geo.lat;
          dLng = geo.lng;
        } catch (e: any) {
          console.warn('[Active Trip API] 解析下車地點失敗:', e.message);
        }
      }
    }
    if (dLat && dLng && !isNaN(dLat) && !isNaN(dLng)) {
      effectiveOrder.dropoff_lat = dLat;
      effectiveOrder.dropoff_lng = dLng;
    }

    res.json({ hasActiveTrip: true, order: effectiveOrder });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 司機網頁版：查詢司機已接單之預約行程清單 (尚未到出發時間之預約單)
app.get('/api/driver/:driverId/scheduled-trips', async (req, res) => {
  try {
    const scheduledOrders = await getScheduledOrdersByDriverId(req.params.driverId);
    res.json({ success: true, count: scheduledOrders.length, scheduledOrders });
  } catch (err: any) {
    res.status(500).json({ error: err.message, scheduledOrders: [] });
  }
});

// 地址地理編碼 API (供前端地圖與導航快速取得座標)
app.get('/api/geocode', async (req, res) => {
  try {
    const address = req.query.address as string;
    if (!address) {
      return res.status(400).json({ error: '請提供 address 參數' });
    }
    const result = await geocodeAddress(address);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 行車路徑規劃 API (提供前端 Leaflet 地圖繪製真實道路行車線，優先 Google Directions ➔ OSRM ➔ 直線保底)
app.get('/api/route', async (req, res) => {
  try {
    const originLat = Number(req.query.originLat);
    const originLng = Number(req.query.originLng);
    const destLat = Number(req.query.destLat);
    const destLng = Number(req.query.destLng);

    if (isNaN(originLat) || isNaN(originLng) || isNaN(destLat) || isNaN(destLng)) {
      return res.status(400).json({ error: '請提供完整的起終點座標 (originLat, originLng, destLat, destLng)' });
    }

    const route = await getDrivingRoute(originLat, originLng, destLat, destLng);
    res.json({ success: true, ...route });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 司機網頁版：查詢司機歷史訂單清單 (右上角選單)
app.get('/api/driver/:driverId/history-orders', async (req, res) => {
  try {
    const history = await getOrdersByDriverId(req.params.driverId, 20);
    res.json({ success: true, orders: history });
  } catch (err: any) {
    res.status(500).json({ error: err.message, orders: [] });
  }
});

// 司機網頁版：行程中補填或更新乘客下車地點
app.post('/api/driver/order/:orderId/destination', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { dropoffAddress } = req.body || {};
    if (!dropoffAddress || !String(dropoffAddress).trim()) {
      return res.status(400).json({ error: '請提供有效的下車目的地地址' });
    }
    const cleanAddr = String(dropoffAddress).trim();
    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: '找不到該訂單' });
    }

    let lat: number | undefined;
    let lng: number | undefined;
    try {
      const geo = await geocodeAddress(cleanAddr);
      lat = geo.lat;
      lng = geo.lng;
    } catch (e: any) {
      console.warn('[Destination Geocode Warning]:', e.message);
    }

    await updateOrderDestination(orderId, cleanAddr, lat, lng);
    res.json({
      success: true,
      dropoffAddress: cleanAddr,
      lat,
      lng,
      message: '已成功更新下車目的地！',
    });
  } catch (err: any) {
    console.error('[Update Destination API Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 司機網頁版：進行中訂單快捷動作回報 (我已到達、客上、乘客下車結單)
app.post('/api/driver/trip-action', async (req, res) => {
  try {
    const { orderId, driverId, action } = req.body;
    if (!orderId || !action) {
      return res.status(400).json({ error: '缺少 orderId 或 action' });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: '找不到該訂單' });
    }

    const lineClient = getLineClient();
    const customerId = order.customer_id;

    if (action === 'arrived') {
      // 司機回報到達上車點：持久化記錄到達狀態
      await markDriverArrived(orderId);
      if (customerId && customerId !== 'UNKNOWN_CUSTOMER') {
        await lineClient.pushMessage({
          to: customerId,
          messages: [
            {
              type: 'text',
              text: `🚖 司機已抵達指定上車地（${order.pickup_address}），請確認車號車色後上車！\n\n⏳ 溫馨提醒：司機等待時間為您選擇的時間加上 5 分鐘緩衝（例如選「準時」，司機可等候 5 分鐘）。超過緩衝 5 分鐘後，將按每分鐘計費。`,
              quickReply: {
                items: [
                  {
                    type: 'action',
                    action: {
                      type: 'message',
                      label: '🟢 準時前往',
                      text: '準時前來，正在前往上車點',
                    },
                  },
                  {
                    type: 'action',
                    action: {
                      type: 'message',
                      label: '🟡 稍等 1-5 分鐘',
                      text: '稍候片刻，約晚 1-5 分鐘抵達',
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return res.json({ success: true, message: '已通知乘客您已到達！' });
    } else if (action === 'picked_up') {
      // 司機回報客上
      await updateOrderStatus(orderId, 'picked_up');
      if (customerId && customerId !== 'UNKNOWN_CUSTOMER') {
        await lineClient.pushMessage({
          to: customerId,
          messages: [
            {
              type: 'text',
              text: '🚕 乘客已上車，行程啟動中！繫好安全帶，祝您路途平安順心！✨',
            },
          ],
        });
      }

      // 同步向司機 1:1 OA 發送包含金額、「確認金額並回報」與「調整訂單金額並回報」按鈕的訂單 Flex Message
      const targetDriverId = driverId || order.driver_id;
      if (targetDriverId) {
        try {
          const driverProfile = await getDriverProfile(targetDriverId);
          const defaultFare = getOrderDefaultFare(order);
          const boardedFareFlex = createDriverBoardedFareConfirmFlexMessage({
            orderId: order.id,
            driverName: driverProfile?.display_name || '司機夥伴',
            pickupAddress: order.pickup_address,
            dropoffAddress: order.dropoff_address,
            passengerCount: order.passenger_count || 1,
            fare: defaultFare,
          });
          await lineClient.pushMessage({
            to: targetDriverId,
            messages: [boardedFareFlex],
          });
        } catch (dPushErr: any) {
          console.warn('[Trip Action picked_up] 推播司機 1:1 OA 金額確認卡片失敗:', dPushErr.message);
        }
      }

      return res.json({ success: true, message: '已更新為「客上」狀態，並已於 1:1 OA 發送結單金額回報卡片！' });
    } else if (action === 'no_show') {
      // 司機回報「客人未出現」：取消訂單並為司機後台計點 +1 點補單點數
      await updateOrderStatus(orderId, 'cancelled');
      const targetDriverId = driverId || order.driver_id;
      const newPoints = targetDriverId ? await addDriverCompensationPoint(targetDriverId, 1) : 1;

      if (customerId && customerId !== 'UNKNOWN_CUSTOMER') {
        endCustomerChatSession(customerId);
        await lineClient.pushMessage({
          to: customerId,
          messages: [
            {
              type: 'text',
              text: `⚠️ 司機已於指定上車地（${order.pickup_address}）等候，因未見您出現，本趟叫車訂單（#${order.id.slice(-4)}）已取消。如需再次用車，請重新預約叫車。`,
            },
          ],
        });
      }
      return res.json({
        success: true,
        compensationPoints: newPoints,
        message: `已回報「客人未出現」並取消訂單！系統已自動為您補償 +1 點【補單點數】（目前可用：${newPoints} 點）！`,
      });
    } else if (action === 'completed') {
      // 司機回報乘客下車 (結單)
      const suppliedFare = req.body.fare ? Number(req.body.fare) : null;
      const finalFare =
        suppliedFare && !isNaN(suppliedFare) && suppliedFare > 0
          ? Math.round(suppliedFare)
          : getOrderDefaultFare(order);

      if (finalFare === null || finalFare <= 0) {
        return res.status(400).json({
          error: '此筆訂單無詳細下車地址，回報下車時必須填寫訂單金額！',
          requireFareInput: true,
          adjustFareUrl: `/driver/adjust-fare?orderId=${orderId}`,
        });
      }

      const completedOrder = await completeOrderWithFare(orderId, finalFare);
      if (order.customer_id) {
        endCustomerChatSession(order.customer_id);
      }
      const shortTripEval = await evaluateShortTripOnCompletion({
        order: completedOrder || order,
        confirmedDropoffAddress: req.body.dropoffAddress,
      });

      const targetDriverId = driverId || order.driver_id;
      const driverProfile = targetDriverId ? await getDriverProfile(targetDriverId) : undefined;
      const driverName = driverProfile?.display_name || '司機夥伴';

      // 同步傳到 chatroom 群組：這筆訂單已完結，金額要顯示
      const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
      if (targetGroupId) {
        try {
          const groupCompletedFlex = createGroupOrderCompletedFlexMessage({
            orderId: order.id,
            driverName,
            pickupAddress: order.pickup_address,
            dropoffAddress: shortTripEval.dropoffAddress || order.dropoff_address,
            fare: finalFare,
            isAdjusted: false,
          });
          await lineClient.pushMessage({
            to: targetGroupId,
            messages: [groupCompletedFlex],
          });
        } catch (gErr: any) {
          console.warn('[Trip Action completed] 推播司機群組結單失敗:', gErr.message);
        }
      }

      if (shortTripEval.isShortTrip && shortTripEval.dropoffAddress && shortTripEval.distanceKm && targetDriverId) {
        await notifyShortTripForVerification({
          order: completedOrder || order,
          driverId: targetDriverId,
          driverName,
          dropoffAddress: shortTripEval.dropoffAddress,
          distanceKm: shortTripEval.distanceKm,
          fare: finalFare,
          pushToDriver: true,
        });
      }

      return res.json({ success: true, message: '行程已圓滿結單並回報至群組！辛苦司機了！' });
    }

    return res.status(400).json({ error: '未知的動作指令' });
  } catch (err: any) {
    console.error('[Trip Action Error]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(recentLogs.join('\n'));
});

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
    const bids = await getBidsByOrderId(req.params.orderId);
    const winnerProfile = order.driver_id ? await getDriverProfile(order.driver_id) : undefined;
    res.json({
      ...order,
      fixed_route: extractFixedRoute(order),
      winnerDriverName: winnerProfile?.display_name || null,
      oaUrl: env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw',
      bidsCount: bids.length,
      hasBids: bids.length > 0,
      bids: bids.map(b => ({ driverId: b.driver_id, etaMinutes: b.eta_minutes })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 管理員後台：常客（固定上下車地點、固定金額、固定路線）CRUD API
// ==========================================
app.get(['/api/admin/regular-customers', '/api/regular-customers'], async (req, res) => {
  try {
    const customers = await listRegularCustomers();
    res.json({ success: true, customers });
  } catch (err: any) {
    res.status(500).json({ error: err.message, customers: [] });
  }
});

app.post(['/api/admin/regular-customers', '/api/regular-customers'], async (req, res) => {
  try {
    const { id, customer_id, customer_name, pickup_address, dropoff_address, fixed_fare, fixed_route, note } = req.body || {};
    if (!pickup_address || !String(pickup_address).trim() || !dropoff_address || !String(dropoff_address).trim()) {
      return res.status(400).json({ error: '請填寫完整的固定上車地點與固定下車地點' });
    }
    const parsedFare = Number(fixed_fare);
    if (!parsedFare || isNaN(parsedFare) || parsedFare <= 0) {
      return res.status(400).json({ error: '請填寫有效的固定金額（須大於 0）' });
    }

    const created = await createRegularCustomer({
      id: id ? String(id) : undefined,
      customer_id: customer_id ? String(customer_id) : null,
      customer_name: customer_name ? String(customer_name) : '常客',
      pickup_address: String(pickup_address),
      dropoff_address: String(dropoff_address),
      fixed_fare: parsedFare,
      fixed_route: fixed_route ? String(fixed_route) : '',
      note: note ? String(note) : null,
    });

    res.json({ success: true, customer: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put(['/api/admin/regular-customers/:id', '/api/regular-customers/:id'], async (req, res) => {
  try {
    const id = String(req.params.id);
    const updated = await updateRegularCustomer(id, req.body || {});
    if (!updated) {
      return res.status(404).json({ error: '找不到該筆常客設定' });
    }
    res.json({ success: true, customer: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(['/api/admin/regular-customers/:id', '/api/regular-customers/:id'], async (req, res) => {
  try {
    const id = String(req.params.id);
    const deleted = await deleteRegularCustomer(id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/admin/regular-customers/match', '/api/regular-customers/match'], async (req, res) => {
  try {
    const { customerId, pickupAddress, dropoffAddress } = req.body || {};
    const matched = await matchRegularCustomerRoute({
      customerId,
      pickupAddress,
      dropoffAddress,
    });
    res.json({
      matched: Boolean(matched),
      customer: matched,
    });
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
    let pickupLat = order.pickup_lat ? Number(order.pickup_lat) : undefined;
    let pickupLng = order.pickup_lng ? Number(order.pickup_lng) : undefined;

    // 若訂單尚未有座標，即時呼叫 Google Geocoding 解析乘客提供的上車地址
    if (!pickupLat || !pickupLng || isNaN(pickupLat) || isNaN(pickupLng)) {
      console.log(`[ETA API] 訂單 ${orderId} 尚未有座標，即時呼叫 Geocoding 解析上車地址: "${order.pickup_address}"`);
      const geo = await geocodeAddress(order.pickup_address);
      pickupLat = geo.lat;
      pickupLng = geo.lng;
    }

    console.log(`[ETA API] 司機座標: (${driverLat}, ${driverLng}) ➔ 乘客上車地點: "${order.pickup_address}" 座標: (${pickupLat}, ${pickupLng})`);

    const etaResult = await calculateDrivingEta(driverLat, driverLng, pickupLat, pickupLng);
    const roundedMinutes = roundUpToFiveMinutes(etaResult.durationMinutes);
    console.log(`[ETA API] Google Maps 測算車程: ${roundedMinutes} 分鐘 (原始: ${etaResult.durationMinutes} 分鐘, ${(etaResult.distanceMeters / 1000).toFixed(1)} km)`);
    res.json({
      ...etaResult,
      durationMinutes: roundedMinutes,
    });
  } catch (err: any) {
    console.error('[ETA API Error]', err);
    res.status(500).json({ error: err.message, durationMinutes: 5 });
  }
});

// 司機網頁版：根據輸入的下車地點，即時試算車資金額與行車距離 (自動結算)
app.post('/api/orders/:orderId/estimate-fare', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { dropoffAddress } = req.body || {};
    if (!dropoffAddress || !String(dropoffAddress).trim()) {
      return res.status(400).json({ error: '請提供下車地址' });
    }
    const cleanDropoff = String(dropoffAddress).trim();
    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: '訂單不存在' });
    }

    const pickupAddr = order.pickup_address || '台北車站';
    let pickupLat = Number((order as any).pickup_lat);
    let pickupLng = Number((order as any).pickup_lng);

    if (!pickupLat || !pickupLng || isNaN(pickupLat) || isNaN(pickupLng)) {
      try {
        const pGeo = await geocodeAddress(pickupAddr);
        pickupLat = pGeo.lat;
        pickupLng = pGeo.lng;
      } catch (e: any) {
        pickupLat = 25.0478;
        pickupLng = 121.5170;
      }
    }

    let dropoffLat: number = 25.0478;
    let dropoffLng: number = 121.5170;
    try {
      const dGeo = await geocodeAddress(cleanDropoff);
      dropoffLat = dGeo.lat;
      dropoffLng = dGeo.lng;
    } catch (e: any) {
      console.warn('[Estimate Fare] Geocode failed for dropoff:', e.message);
    }

    let distanceKm = 1.0;
    try {
      const eta = await calculateDrivingEta(pickupLat, pickupLng, dropoffLat, dropoffLng);
      distanceKm = Number((eta.distanceMeters / 1000).toFixed(1));
    } catch (e: any) {
      // 備援：Haversine × 1.3
      const straightMeters = calculateHaversineDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
      distanceKm = Number(((straightMeters * 1.3) / 1000).toFixed(1));
    }

    if (distanceKm <= 0) distanceKm = 1.0;

    const fareRes = calculateCityFare(distanceKm);
    const estimatedFare = fareRes.estimatedFare || 120;
    const isShortTrip = distanceKm <= 5.0;

    res.json({
      success: true,
      pickupAddress: pickupAddr,
      dropoffAddress: cleanDropoff,
      distanceKm,
      estimatedFare,
      fareBreakdown: fareRes.fareBreakdown,
      isShortTrip,
    });
  } catch (err: any) {
    console.error('[Estimate Fare API Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 需求 3: 司機回報短距離單 (輸入下車地點，計算里程並標記短程單)
app.post('/api/orders/report-short-trip', async (req, res) => {
  try {
    const { orderId, driverId, dropoffAddress } = req.body;
    if (!orderId || !dropoffAddress) {
      return res.status(400).json({ error: '缺少訂單編號或下車地點' });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: '訂單不存在' });
    }

    // 取得上車點座標
    const pickupLat = (order as any).pickup_lat || 25.0478;
    const pickupLng = (order as any).pickup_lng || 121.5170;

    // 解析下車地點座標
    const dropoffGeo = await geocodeAddress(dropoffAddress);

    // 計算兩點行車距離 (Google Distance Matrix API)
    const etaResult = await calculateDrivingEta(pickupLat, pickupLng, dropoffGeo.lat, dropoffGeo.lng);
    const distanceKm = Number((etaResult.distanceMeters / 1000).toFixed(1));

    // 依據參數表規則：5 公里以下認定為短程單
    const isShortTrip = distanceKm <= 5.0;

    // 更新訂單資料庫
    await updateOrderDropoffAndDistance(orderId, dropoffAddress, distanceKm, isShortTrip);

    console.log(`[Short Trip Reported] 訂單 ${orderId} 下車地點更新為: ${dropoffAddress}, 里程: ${distanceKm} km, 是否短單: ${isShortTrip}`);

    res.json({
      success: true,
      orderId,
      dropoffAddress,
      distanceKm,
      isShortTrip,
      message: isShortTrip ? '符合短程單門檻，已成功記錄！' : '已成功記錄下車地點與里程',
    });
  } catch (err: any) {
    console.error('[Short Trip Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 司機於「調整訂單金額並回報」網頁送出修改金額、確認下車地點與備註，視同回報結單並推播至 chatroom 群組
app.post('/api/orders/complete-with-fare', async (req, res) => {
  try {
    const { orderId, driverId, fare, dropoffAddress, adjustNote, isAdjusted } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: '缺少訂單編號' });
    }

    const existingOrder = await getOrderById(orderId);
    if (!existingOrder) {
      return res.status(404).json({ error: '找不到該筆訂單' });
    }

    const parsedFare = Number(fare);
    if (!parsedFare || isNaN(parsedFare) || parsedFare <= 0) {
      return res.status(400).json({ error: '請輸入有效的訂單金額' });
    }

    const finalFare = Math.round(parsedFare);
    const trimmedNote = typeof adjustNote === 'string' ? adjustNote.trim() : '';

    const completedOrder = await completeOrderWithFare(orderId, finalFare, trimmedNote || undefined);
    if (!completedOrder) {
      return res.status(500).json({ error: '更新結單金額失敗' });
    }
    if (completedOrder.customer_id) {
      endCustomerChatSession(completedOrder.customer_id);
    }

    // 偵測上車地點與確認後之下車地點距離，若小於 5 公里即判定為短程單
    const shortTripEval = await evaluateShortTripOnCompletion({
      order: completedOrder,
      confirmedDropoffAddress: typeof dropoffAddress === 'string' ? dropoffAddress : undefined,
    });
    if (shortTripEval.dropoffAddress) {
      completedOrder.dropoff_address = shortTripEval.dropoffAddress;
    }

    const effectiveDriverId = driverId || completedOrder.driver_id;
    const driverProfile = effectiveDriverId ? await getDriverProfile(effectiveDriverId) : undefined;
    const driverName = driverProfile?.display_name || '司機夥伴';

    const lineClient = getLineClient();

    // 1. 傳送到司機群組 (chatroom)：這筆訂單已完結，金額顯示修改後的金額（與備註）
    const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
    if (targetGroupId) {
      try {
        const groupCompletedFlex = createGroupOrderCompletedFlexMessage({
          orderId: completedOrder.id,
          driverName,
          pickupAddress: completedOrder.pickup_address,
          dropoffAddress: completedOrder.dropoff_address,
          fare: finalFare,
          isAdjusted: Boolean(isAdjusted ?? true),
          adjustNote: trimmedNote || null,
        });
        await lineClient.pushMessage({
          to: targetGroupId,
          messages: [groupCompletedFlex],
        });
        console.log(
          `[Complete With Fare] ✅ 已向司機群組推播訂單 #${completedOrder.id.slice(-4)} 完結！修改後金額: $${finalFare} | 備註: ${trimmedNote || '無'}`
        );
      } catch (gErr: any) {
        console.warn('[Complete With Fare] 推播司機群組結單失敗:', gErr.message);
      }
    }

    // 2. 1:1 OA 通知司機結單完成（依需求，結單金額回報無須推播客人的 1:1 OA；若為短程單，一併發送短程單 Flex Message 給司機，並發送核實 Flex Message 到管理群組）
    if (shortTripEval.isShortTrip && shortTripEval.dropoffAddress && shortTripEval.distanceKm !== null) {
      const { driverFlex } = await notifyShortTripForVerification({
        order: completedOrder,
        driverId: effectiveDriverId || 'UNKNOWN_DRIVER',
        driverName,
        dropoffAddress: shortTripEval.dropoffAddress,
        distanceKm: shortTripEval.distanceKm,
        fare: finalFare,
        adjustNote: trimmedNote || null,
        pushToDriver: false,
      });

      if (effectiveDriverId && !effectiveDriverId.startsWith('DEV_DRIVER_')) {
        try {
          const noteLine = trimmedNote ? `\n📝 調整備註：${trimmedNote}` : '';
          await lineClient.pushMessage({
            to: effectiveDriverId,
            messages: [
              {
                type: 'text',
                text: `🎉【訂單已完結並回報群組】\n\n🧾 訂單編號：#${completedOrder.id.slice(-4)}\n🟢 上車：${completedOrder.pickup_address}\n🔴 下車：${completedOrder.dropoff_address || '乘客指定地點'}\n💰 結單金額：$${finalFare}${noteLine}\n\n已同步將完結與修改後金額回報至聊天室群組！辛苦司機夥伴了！🚖`,
              },
              driverFlex,
            ],
          });
        } catch (dErr: any) {
          console.warn('[Complete With Fare] 推播司機 1:1 OA 失敗:', dErr.message);
        }
      }
    } else if (effectiveDriverId && !effectiveDriverId.startsWith('DEV_DRIVER_')) {
      try {
        const noteLine = trimmedNote ? `\n📝 調整備註：${trimmedNote}` : '';
        await lineClient.pushMessage({
          to: effectiveDriverId,
          messages: [
            {
              type: 'text',
              text: `🎉【訂單已完結並回報群組】\n\n🧾 訂單編號：#${completedOrder.id.slice(-4)}\n🟢 上車：${completedOrder.pickup_address}\n🔴 下車：${completedOrder.dropoff_address || '乘客指定地點'}\n💰 結單金額：$${finalFare}${noteLine}\n\n已同步將完結與修改後金額回報至聊天室群組！辛苦司機夥伴了！🚖`,
            },
          ],
        });
      } catch (dErr: any) {
        console.warn('[Complete With Fare] 推播司機 1:1 OA 失敗:', dErr.message);
      }
    }

    res.json({
      success: true,
      order: completedOrder,
      fare: finalFare,
      adjustNote: trimmedNote || null,
      isShortTrip: shortTripEval.isShortTrip,
      distanceKm: shortTripEval.distanceKm,
    });
  } catch (err: any) {
    console.error('[Complete With Fare Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 司機提交出價並接單
app.post('/api/dispatch/bid', async (req, res) => {
  try {
    const { orderId, driverId, driverLat, driverLng, etaMinutes, useCompensationPoint } = req.body;
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
        notes: driver?.notes || '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000',
        registered: true,
        status: 'active',
      });
    }

    const driverName = driver.display_name || '司機夥伴';
    const availablePoints = Number(driver.compensation_points || 0);
    const effectiveUseCompensation = Boolean(useCompensationPoint) && availablePoints > 0;

    // 寫入出價（若勾選使用補單點數且點數 > 0，將在 submitBid 內立即結單指派並觸發 Chat room 接單後流程）
    const bid = await dispatchEngine.submitBid({
      orderId,
      driverId,
      lat: Number(driverLat),
      lng: Number(driverLng),
      etaMinutes: Number(etaMinutes) || 5,
      useCompensationPoint: effectiveUseCompensation,
    });

    const isInstantWon = Boolean(bid.instantWon);

    console.log(
      `[Dispatch API] 司機 ${driverName} (${driverId}) 出價成功！預估車程: ${etaMinutes} 分鐘 | 使用補單點數立即結單: ${isInstantWon}`
    );

    // 確保接單司機 1:1 OA 具備司機專屬圖文選單
    linkDriverRichMenu(driverId).catch((rmErr: any) => {
      console.warn('[Dispatch Bid] 綁定司機 Rich Menu 失敗:', rmErr.message);
    });

    const lineClient = getLineClient();

    // 若非使用補單點數立即結單，才在司機群組發布「系統派單媒合中...」動態
    // （若已使用補單點數立即結單，onOrderResolved 已直接向 Chat room 推播結單中單卡片與後續流程）
    const driverGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
    if (driverGroupId && !isInstantWon) {
      const order = await getOrderById(orderId);
      const isRes = order ? isFutureReservation(order) : false;
      const statusText = isRes
        ? `🚕【${driverName}】已接單（預約行程），系統派單媒合中...`
        : `🚕【${driverName}】已接單 (預估 ${etaMinutes} 分鐘抵達)，系統派單媒合中...`;

      lineClient.pushMessage({
        to: driverGroupId,
        messages: [
          {
            type: 'text',
            text: statusText,
          },
        ],
      }).catch((gErr: any) => {
        console.warn('[Dispatch API] 推播司機群組接單動態失敗:', gErr.message);
      });
    }

    const updatedDriver = await getDriverProfile(driverId);

    res.json({
      success: true,
      bid,
      driverName,
      instantWon: isInstantWon,
      usedCompensationPoint: isInstantWon,
      compensationPoints: Number(updatedDriver?.compensation_points || 0),
    });
  } catch (err: any) {
    console.error('[Dispatch Bid Error]', err);
    res.status(400).json({ error: err.message });
  }
});

// 司機身分反查 (依車牌、電話或姓名)
app.get('/api/driver/lookup', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    if (!q) {
      return res.status(400).json({ error: '請提供車牌或電話號碼' });
    }
    const driver = await findDriverByPhoneOrPlate(q);
    if (!driver) {
      return res.status(404).json({ error: '找不到相符的司機登記資料' });
    }
    res.json({ success: true, driver });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      notes: notes || '🚭 禁菸 🚯 禁食 🤮 嘔吐加收3000',
      registered: true,
      status: 'active',
    });

    console.log(`[Driver API] 司機 ${userId} (${displayName}) 透過 LIFF 完成登記！`);

    // 自動為註冊完成的司機綁定專屬司機 Rich Menu
    linkDriverRichMenu(userId).catch((rmErr: any) => {
      console.warn('[Driver API] 綁定司機 Rich Menu 失敗:', rmErr.message);
    });

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

// 註冊預約單排程生命週期勾點 (供 10 小時前廣播、每 30 分鐘重跳、1 小時前無司機取消、管理員重啟派單呼叫)
registerReservationLifecycleHooks({
  onStartDispatch: async (orderId) => {
    await dispatchEngine.startDispatch(orderId, 30);
  },
  onCancelDispatch: async (orderId) => {
    await dispatchEngine.cancelDispatch(orderId);
  },
});

// 管理員重啟「超過 1 小時未按我知道了」之預約單 API
app.post(['/api/orders/:orderId/reopen', '/api/admin/orders/:orderId/reopen'], async (req, res) => {
  try {
    const orderId = String(req.params.orderId);
    const force = Boolean(req.body?.force);
    const result = await reopenReservationOrder(orderId, { force });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
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
  // 載入自訂靜默問題清單與啟動定時日報排程器
  loadSilentRulesFromExcel();
  initDailyReportScheduler();
  startReservationReminderWorker();

  app.listen(env.PORT, () => {
    console.log(`[Server] Taxi dispatch system listening on port ${env.PORT}`);
  });
}

export default app;
