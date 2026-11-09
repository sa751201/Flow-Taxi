import { getLineClient } from './line-client.js';
import { query } from '../db/index.js';
import { env } from '../config/env.js';
import {
  memoryOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderNote,
  markReservationBroadcasted,
  resetOrderToPendingForRedispatch,
  extractFixedRoute,
} from '../db/queries/orders.js';
import { getDriverById } from '../db/queries/drivers.js';
import { Order } from '../types/dispatch.js';
import {
  extractScheduledTimeText,
  getScheduledDate,
  isReservationOrder,
  hasDriverAck,
  requiresDriverAck,
  canAdminReopenUnacknowledgedReservation,
  evaluateReservationDispatchAction,
} from './reservation.js';
import {
  createDriverOrderCardFlexMessage,
  createGroupDispatchOrderFlexMessage,
  createAdminUnacknowledgedReservationFlexMessage,
} from './flex-messages.js';

let reminderIntervalTimer: NodeJS.Timeout | null = null;

export interface ReservationLifecycleHooks {
  onStartDispatch?: (orderId: string) => Promise<void>;
  onCancelDispatch?: (orderId: string) => Promise<void>;
}

let lifecycleHooks: ReservationLifecycleHooks = {};

export function registerReservationLifecycleHooks(hooks: ReservationLifecycleHooks): void {
  lifecycleHooks = { ...lifecycleHooks, ...hooks };
}

/**
 * 將預約單派單 Flex Message 廣播至司機群組，並記錄最後廣播時間戳
 */
export async function broadcastReservationOrderToGroup(
  order: Order,
  now: Date = new Date()
): Promise<boolean> {
  const lineClient = getLineClient();
  const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
  const scheduledText = extractScheduledTimeText(order);

  const bidUrl = env.LIFF_ID
    ? `https://liff.line.me/${env.LIFF_ID}/driver/bid?orderId=${order.id}`
    : `https://flow-taxi-production.up.railway.app/driver/bid?orderId=${order.id}`;

  const shortTripUrl = env.LIFF_ID
    ? `https://liff.line.me/${env.LIFF_ID}/driver/short-trip?orderId=${order.id}`
    : `https://flow-taxi-production.up.railway.app/driver/short-trip?orderId=${order.id}`;

  await markReservationBroadcasted(order.id, now);

  if (!targetGroupId) return false;

  try {
    const dispatchFlex = createGroupDispatchOrderFlexMessage({
      orderId: order.id,
      pickupAddress: order.pickup_address,
      dropoffAddress: order.dropoff_address || undefined,
      passengerCount: order.passenger_count || 1,
      scheduledTimeText: scheduledText,
      isReservation: true,
      estimatedFare: order.fare ? Number(order.fare) : undefined,
      distanceKm: order.distance_km ? Number(order.distance_km) : undefined,
      fixedRoute: extractFixedRoute(order),
      bidUrl,
      shortTripUrl: !order.dropoff_address ? shortTripUrl : undefined,
    });

    await lineClient.pushMessage({
      to: targetGroupId,
      messages: [dispatchFlex],
    });
    console.log(`[Reservation Lifecycle] ✅ 已在司機群組廣播預約單 #${order.id.slice(-4)} (預約時間: ${scheduledText})`);
    return true;
  } catch (err: any) {
    console.warn(`[Reservation Lifecycle] 推播預約單 #${order.id.slice(-4)} 至司機群組失敗:`, err.message);
    return false;
  }
}

/**
 * 處理預約單全生命週期排程：
 * 1. 上車前 10 小時在群組跳出派單 Flex Message；若無人接單且未取消，每 30 分鐘重跳一次
 * 2. 出發前 1 小時若仍無司機接單，結單並通知客人無司機接單
 * 3. 司機接預約單後若超過 1 小時未按「我知道了」，通知管理員可重啟派單找其他司機
 */
export async function processReservationLifecycle(now: Date = new Date()): Promise<{
  broadcastedCount: number;
  cutoffNoDriverCount: number;
  adminAlertCount: number;
}> {
  const lineClient = getLineClient();
  let broadcastedCount = 0;
  let cutoffNoDriverCount = 0;
  let adminAlertCount = 0;

  const activeReservations: Order[] = [];

  if (env.DATABASE_URL) {
    try {
      const res = await query<Order>(
        `SELECT * FROM orders
         WHERE scheduled_time IS NOT NULL
           AND status IN ('pending', 'dispatching', 'accepted');`
      );
      activeReservations.push(...res.rows);
    } catch {}
  }

  for (const order of memoryOrders.values()) {
    if (
      ['pending', 'dispatching', 'accepted'].includes(order.status) &&
      isReservationOrder(order, now)
    ) {
      if (!activeReservations.some((o) => o.id === order.id)) {
        activeReservations.push(order);
      }
    }
  }

  for (const order of activeReservations) {
    try {
      const scheduledText = extractScheduledTimeText(order);

      // A. 尚未有司機接單之預約單 (pending 或 dispatching 且無 driver_id)
      if ((order.status === 'pending' || order.status === 'dispatching') && !order.driver_id) {
        const action = evaluateReservationDispatchAction(order, now);

        if (action === 'cutoff_no_driver') {
          if (order.note?.includes('[NO_DRIVER_NOTIFIED]')) continue;

          if (lifecycleHooks.onCancelDispatch) {
            await lifecycleHooks.onCancelDispatch(order.id).catch(() => {});
          }
          await updateOrderStatus(order.id, 'no_driver');
          const nextNote = `${order.note || ''} [NO_DRIVER_NOTIFIED]`.trim();
          order.note = nextNote;
          await updateOrderNote(order.id, nextNote);

          if (order.customer_id) {
            try {
              await lineClient.pushMessage({
                to: order.customer_id,
                messages: [
                  {
                    type: 'text',
                    text: `⚠️【預約叫車無司機接單通知】\n抱歉，您預約於 ${scheduledText} 出發的行程（訂單 #${order.id.slice(-4)}，上車點：${order.pickup_address}），截至出發前 1 小時尚無司機接單，系統已自動結束此筆預約單。建議您改搭其他交通工具或於出發時重新叫車，造成不便敬請見諒！`,
                  },
                ],
              });
            } catch (pushErr: any) {
              console.warn(`[Reservation Lifecycle] 推播乘客無司機接單失敗:`, pushErr.message);
            }
          }
          cutoffNoDriverCount++;
          continue;
        }

        if (action === 'broadcast_now') {
          await broadcastReservationOrderToGroup(order, now);
          if (order.status === 'pending') {
            if (lifecycleHooks.onStartDispatch) {
              await lifecycleHooks.onStartDispatch(order.id);
            } else {
              await updateOrderStatus(order.id, 'dispatching');
            }
          }
          broadcastedCount++;
          continue;
        }
      }

      // B. 已有司機接單之預約單：檢查是否超過 1 小時未按「我知道了」
      if (order.status === 'accepted' && order.driver_id) {
        if (
          canAdminReopenUnacknowledgedReservation(order, now) &&
          (!order.note || !order.note.includes('[ADMIN_ACK_ALERT_SENT]'))
        ) {
          const nextNote = `${order.note || ''} [ADMIN_ACK_ALERT_SENT]`.trim();
          order.note = nextNote;
          await updateOrderNote(order.id, nextNote);

          if (env.ADMIN_GROUP_ID) {
            try {
              const driver = await getDriverById(order.driver_id);
              const driverName = driver?.display_name || '司機夥伴';
              const alertFlex = createAdminUnacknowledgedReservationFlexMessage({
                orderId: order.id,
                driverName,
                scheduledTimeText: scheduledText,
                pickupAddress: order.pickup_address,
                dropoffAddress: order.dropoff_address,
              });

              await lineClient.pushMessage({
                to: env.ADMIN_GROUP_ID,
                messages: [alertFlex],
              });
            } catch (adminErr: any) {
              console.warn(`[Reservation Lifecycle] 推播管理員未確認預約單提醒失敗:`, adminErr.message);
            }
          }
          adminAlertCount++;
        }
      }
    } catch (err: any) {
      console.error(`[Reservation Lifecycle] 處理預約單 ${order.id} 異常:`, err.message);
    }
  }

  return { broadcastedCount, cutoffNoDriverCount, adminAlertCount };
}

/**
 * 管理員重啟「超過 1 小時未按我知道了」之預約單，重新尋找其他司機處理
 */
export async function reopenReservationOrder(
  orderId: string,
  options?: { force?: boolean; now?: Date }
): Promise<{
  success: boolean;
  error?: string;
  order?: Order;
  previousDriverId?: string | null;
}> {
  const now = options?.now || new Date();
  const order = await getOrderById(orderId);
  if (!order) {
    return { success: false, error: '找不到該筆預約訂單' };
  }

  if (!isReservationOrder(order, now)) {
    return { success: false, error: '此訂單非預約單，無法執行預約單重啟' };
  }

  if (!options?.force) {
    if (hasDriverAck(order)) {
      return { success: false, error: '接單司機已點擊「我知道了」確認此預約單，無法重啟' };
    }
    if (!canAdminReopenUnacknowledgedReservation(order, now)) {
      return { success: false, error: '司機接單尚未滿 1 小時，請待滿 1 小時未確認後再重啟' };
    }
  }

  const previousDriverId = order.driver_id;
  const scheduledText = extractScheduledTimeText(order);

  const resetOrder = await resetOrderToPendingForRedispatch(orderId);
  if (!resetOrder) {
    return { success: false, error: '重置預約單狀態失敗' };
  }

  const lineClient = getLineClient();

  if (previousDriverId) {
    try {
      await lineClient.pushMessage({
        to: previousDriverId,
        messages: [
          {
            type: 'text',
            text: `⚠️【預約單已重新派單】\n由於您承接預約單 #${orderId.slice(-4)}（乘車時間：${scheduledText}）後超過 1 小時未點擊「我知道了」確認，管理員已重啟此筆預約單並改派其他司機處理。`,
          },
        ],
      });
    } catch (dErr: any) {
      console.warn('[Reopen Reservation] 通知原司機失敗:', dErr.message);
    }
  }

  // 若目前已進入上車前 10 小時內（且大於 1 小時），立即重新在司機群組跳出 Flex Message 並開啟派單
  const action = evaluateReservationDispatchAction(resetOrder, now);
  if (action === 'broadcast_now') {
    await broadcastReservationOrderToGroup(resetOrder, now);
    if (lifecycleHooks.onStartDispatch) {
      await lifecycleHooks.onStartDispatch(resetOrder.id);
    } else {
      await updateOrderStatus(resetOrder.id, 'dispatching');
    }
  }

  return {
    success: true,
    order: resetOrder,
    previousDriverId,
  };
}

/**
 * 檢查並發送「預約乘車時間前 1 小時」之乘客與司機出車提醒
 */
export async function checkAndSendReservationReminders(now: Date = new Date()): Promise<number> {
  // 先執行預約單排程巡檢（前 10 小時廣播、每 30 分鐘重跳、前 1 小時無司機結單、1 小時未按我知道了通報）
  await processReservationLifecycle(now);

  const lineClient = getLineClient();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

  const candidateOrders: Order[] = [];

  // 1. 查詢資料庫
  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT * FROM orders
        WHERE status = 'accepted'
          AND scheduled_time IS NOT NULL
          AND scheduled_time > $2
          AND scheduled_time <= $1
          AND (note IS NULL OR note NOT LIKE '%[REMINDER_SENT]%');
      `;
      const fifteenMinsAgo = new Date(now.getTime() - 15 * 60000);
      const res = await query<Order>(sql, [oneHourLater, fifteenMinsAgo]);
      candidateOrders.push(...res.rows);
    } catch (dbErr: any) {
      console.warn('[Reservation Reminder] 查詢資料庫預約提醒失敗，使用記憶體備援:', dbErr.message);
    }
  }

  // 2. 記憶體備援查詢
  for (const order of memoryOrders.values()) {
    if (
      order.status === 'accepted' &&
      isReservationOrder(order, now) &&
      !(order as any).reminder_sent &&
      (!order.note || !order.note.includes('[REMINDER_SENT]'))
    ) {
      const schDate = getScheduledDate(order, now);
      if (schDate && schDate.getTime() <= oneHourLater.getTime() && schDate.getTime() > now.getTime() - 15 * 60000) {
        if (!candidateOrders.some((o) => o.id === order.id)) {
          candidateOrders.push(order);
        }
      }
    }
  }

  let sentCount = 0;

  for (const order of candidateOrders) {
    try {
      // 若該預約單要求司機先按「我知道了」，則須等司機按下「我知道了」後才發送前 1 小時出車通知
      if (requiresDriverAck(order) && !hasDriverAck(order)) {
        continue;
      }

      console.log(`[Reservation Reminder] 觸發訂單 ${order.id} 乘車前 1 小時提醒！`);

      // 標記 reminder_sent 避免重複發送
      (order as any).reminder_sent = true;
      const updatedNote = `${order.note || ''} [REMINDER_SENT]`.trim();
      order.note = updatedNote;
      await updateOrderNote(order.id, updatedNote);

      const scheduledText = extractScheduledTimeText(order);

      // 1. 推播乘客 1:1 OA
      if (order.customer_id) {
        try {
          await lineClient.pushMessage({
            to: order.customer_id,
            messages: [
              {
                type: 'text',
                text: `⏰【預約用車提醒】\n您預約的行程將於 1 小時後（${scheduledText}）出發！\n📍 上車地點：${order.pickup_address}\n${order.dropoff_address ? '🏁 下車地點：' + order.dropoff_address + '\n' : ''}司機夥伴已收到出車提醒並準備前往接送，請您做好搭車準備。如有任何問題可隨時輸入「與司機溝通」！✨`,
              },
            ],
          });
          console.log(`[Reservation Reminder] ✅ 成功向乘客 1:1 OA 發送用車前 1 小時提醒: ${order.customer_id}`);
        } catch (cErr: any) {
          console.warn(`[Reservation Reminder] 推播乘客失敗:`, cErr.message);
        }
      }

      // 2. 推播司機 1:1 OA (正式進入出車前往流程，附該訂單資訊之 Flex Message)
      if (order.driver_id) {
        try {
          const driver = await getDriverById(order.driver_id);
          const driverName = driver?.display_name || '司機夥伴';

          const driverTaskCard = createDriverOrderCardFlexMessage({
            driverName,
            orderId: order.id,
            pickupAddress: order.pickup_address,
            dropoffAddress: order.dropoff_address,
            passengerCount: order.passenger_count || 1,
            etaMinutes: 15,
            scheduledTimeText: scheduledText,
          });

          await lineClient.pushMessage({
            to: order.driver_id,
            messages: [
              {
                type: 'text',
                text: `⏰【預約行程出車提醒】\n您承接的預約訂單 #${order.id.slice(-4)} 將於 1 小時後（${scheduledText}）開始！\n請您前往上車地點接送乘客。到達後請回報「到」！祝出車順利平安！🚖`,
              },
              driverTaskCard,
            ],
          });
          console.log(`[Reservation Reminder] ✅ 成功向司機 1:1 OA 發送出車提醒與任務卡片: ${order.driver_id}`);
        } catch (dErr: any) {
          console.warn(`[Reservation Reminder] 推播司機失敗:`, dErr.message);
        }
      }

      sentCount++;
    } catch (err: any) {
      console.error(`[Reservation Reminder] 處理訂單 ${order.id} 提醒失敗:`, err.message);
    }
  }

  return sentCount;
}

/**
 * 啟動定時巡檢 Worker (每 30 秒執行一次)
 */
export function startReservationReminderWorker(): void {
  if (reminderIntervalTimer) return;
  console.log('[Reservation Reminder] 啟動預約行程 1 小時出車提醒定時巡檢服務 (每 30 秒)...');
  // 伺服器啟動時先立即巡檢一次
  checkAndSendReservationReminders().catch(() => {});
  reminderIntervalTimer = setInterval(() => {
    checkAndSendReservationReminders().catch(() => {});
  }, 30000);
}

/**
 * 停止定時巡檢 Worker
 */
export function stopReservationReminderWorker(): void {
  if (reminderIntervalTimer) {
    clearInterval(reminderIntervalTimer);
    reminderIntervalTimer = null;
    console.log('[Reservation Reminder] 已停止預約行程提醒定時巡檢服務');
  }
}
