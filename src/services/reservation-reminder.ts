import { getLineClient } from './line-client.js';
import { query } from '../db/index.js';
import { env } from '../config/env.js';
import { memoryOrders, updateOrderStatus } from '../db/queries/orders.js';
import { getDriverById } from '../db/queries/drivers.js';
import { Order } from '../types/dispatch.js';
import { formatScheduledTime } from './reservation.js';
import { createDriverOrderCardFlexMessage } from './flex-messages.js';

let reminderIntervalTimer: NodeJS.Timeout | null = null;

/**
 * 檢查並發送「預約乘車時間前 1 小時」之乘客與司機出車提醒
 */
export async function checkAndSendReservationReminders(): Promise<number> {
  const lineClient = getLineClient();
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

  const candidateOrders: Order[] = [];

  // 1. 查詢資料庫
  if (env.DATABASE_URL) {
    try {
      const sql = `
        SELECT * FROM orders
        WHERE status = 'accepted'
          AND scheduled_time IS NOT NULL
          AND scheduled_time > now() - interval '15 minutes'
          AND scheduled_time <= $1
          AND (note IS NULL OR note NOT LIKE '%[REMINDER_SENT]%');
      `;
      const res = await query<Order>(sql, [oneHourLater]);
      candidateOrders.push(...res.rows);
    } catch (dbErr: any) {
      console.warn('[Reservation Reminder] 查詢資料庫預約提醒失敗，使用記憶體備援:', dbErr.message);
    }
  }

  // 2. 記憶體備援查詢
  for (const order of memoryOrders.values()) {
    if (
      order.status === 'accepted' &&
      order.scheduled_time &&
      !(order as any).reminder_sent &&
      (!order.note || !order.note.includes('[REMINDER_SENT]'))
    ) {
      const schDate = new Date(order.scheduled_time);
      if (schDate.getTime() <= oneHourLater.getTime() && schDate.getTime() > now.getTime() - 15 * 60000) {
        if (!candidateOrders.some((o) => o.id === order.id)) {
          candidateOrders.push(order);
        }
      }
    }
  }

  let sentCount = 0;

  for (const order of candidateOrders) {
    try {
      console.log(`[Reservation Reminder] 觸發訂單 ${order.id} 乘車前 1 小時提醒！`);

      // 標記 reminder_sent 避免重複發送
      (order as any).reminder_sent = true;
      const updatedNote = `${order.note || ''} [REMINDER_SENT]`.trim();
      order.note = updatedNote;

      if (env.DATABASE_URL) {
        try {
          await query(`UPDATE orders SET note = $1 WHERE id = $2;`, [updatedNote, order.id]);
        } catch {}
      }

      const scheduledText = order.note?.replace('預約時間: ', '').replace('[REMINDER_SENT]', '').trim() ||
        (order.scheduled_time ? formatScheduledTime(order.scheduled_time) : '');

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

      // 2. 推播司機 1:1 OA (正式進入出車前往流程)
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
