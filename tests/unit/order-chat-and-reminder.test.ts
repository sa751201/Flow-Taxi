import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPushMessage = vi.fn().mockResolvedValue({});
const mockReplyMessage = vi.fn().mockResolvedValue({});
const mockBroadcast = vi.fn().mockResolvedValue({});

// 模擬 LINE Client，防止單元測試期間向真實司機/管理員群組與使用者推播訊息
vi.mock('../../src/services/line-client.js', () => ({
  getLineClient: vi.fn(() => ({
    pushMessage: mockPushMessage,
    replyMessage: mockReplyMessage,
    broadcast: mockBroadcast,
    getProfile: vi.fn().mockResolvedValue({ displayName: '測試用戶' }),
    getGroupMemberProfile: vi.fn().mockResolvedValue({ displayName: '測試司機' }),
  })),
}));

import {
  startCustomerChatSession,
  endCustomerChatSession,
  isCustomerInChatSession,
  getCustomerChatOrderId,
  resolveOrderForCommunication,
  forwardMessageToPassenger,
  forwardMessageToDriver,
} from '../../src/services/order-chat.js';
import { getLineClient } from '../../src/services/line-client.js';
import { upsertDriver, driversMap } from '../../src/db/queries/drivers.js';
import {
  createOrder,
  getActiveOrderByCustomerId,
  getActiveReservationOrdersByCustomerId,
  getScheduledOrdersByDriverId,
  getActiveOrderByDriverId,
  markReservationAwaitingDriverAck,
  acknowledgeReservationOrder,
  memoryOrders,
} from '../../src/db/queries/orders.js';
import {
  checkAndSendReservationReminders,
  processReservationLifecycle,
  reopenReservationOrder,
} from '../../src/services/reservation-reminder.js';
import { formatScheduledTime } from '../../src/services/reservation.js';

describe('Order Chat & Reservation Reminder Tests', () => {
  beforeEach(() => {
    memoryOrders.clear();
    mockPushMessage.mockClear();
    mockReplyMessage.mockClear();
  });

  describe('Order Chat Service', () => {
    it('應正確管理顧客通話 session 狀態', () => {
      const custId = 'U_chat_cust_1';
      const orderId = 'order_test_123';

      expect(isCustomerInChatSession(custId)).toBe(false);
      startCustomerChatSession(custId, orderId);
      expect(isCustomerInChatSession(custId)).toBe(true);
      expect(getCustomerChatOrderId(custId)).toBe(orderId);

      endCustomerChatSession(custId);
      expect(isCustomerInChatSession(custId)).toBe(false);
      expect(getCustomerChatOrderId(custId)).toBeUndefined();
    });

    it('無進行中訂單時，resolveOrderForCommunication 應回傳 noOrders', async () => {
      const result = await resolveOrderForCommunication('U_no_order_user', '與司機溝通');
      expect(result.noOrders).toBe(true);
      expect(result.ordersWithDriver).toHaveLength(0);
    });

    it('僅有媒合中訂單時，應回傳 pendingOnly', async () => {
      const custId = 'U_pending_user';
      await createOrder({
        id: 'ord-pending-1',
        customer_id: custId,
        pickup_address: '台北市大安區信義路四段',
        pickup_lat: 25.033,
        pickup_lng: 121.551,
      });

      const result = await resolveOrderForCommunication(custId, '與司機溝通');
      expect(result.pendingOnly).toBe(true);
      expect(result.needsDisambiguation).toBe(false);
    });

    it('僅有 1 筆司機接單之訂單時，應直接鎖定 targetOrder', async () => {
      const custId = 'U_single_accepted';
      const ord = await createOrder({
        id: 'ord-accepted-1',
        customer_id: custId,
        pickup_address: '台北車站',
        pickup_lat: 25.047,
        pickup_lng: 121.517,
      });
      ord.driver_id = 'D_driver_1';
      ord.status = 'accepted';

      const result = await resolveOrderForCommunication(custId, '與司機溝通');
      expect(result.needsDisambiguation).toBe(false);
      expect(result.targetOrder?.id).toBe('ord-accepted-1');
    });

    it('同時有多筆司機接單之訂單且未指定單號時，應提示消歧義 (needsDisambiguation = true)', async () => {
      const custId = 'U_multi_orders';
      const ord1 = await createOrder({
        id: 'ord-instant-1001',
        customer_id: custId,
        pickup_address: '市區搭乘起點',
        pickup_lat: 25.033,
        pickup_lng: 121.551,
      });
      ord1.driver_id = 'D_driver_1';
      ord1.status = 'accepted';

      const futureDate = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 小時後
      const ord2 = await createOrder({
        id: 'ord-reserve-2002',
        customer_id: custId,
        pickup_address: '預約搭乘起點',
        pickup_lat: 25.047,
        pickup_lng: 121.517,
        scheduled_time: futureDate,
      });
      ord2.driver_id = 'D_driver_2';
      ord2.status = 'accepted';

      const result = await resolveOrderForCommunication(custId, '與司機溝通');
      expect(result.needsDisambiguation).toBe(true);
      expect(result.ordersWithDriver).toHaveLength(2);
    });

    it('文字中帶有 #單號後碼 時，應精準鎖定對應訂單', async () => {
      const custId = 'U_multi_orders_target';
      const ord1 = await createOrder({
        id: 'ord-instant-1001',
        customer_id: custId,
        pickup_address: '市區搭乘起點',
        pickup_lat: 25.033,
        pickup_lng: 121.551,
      });
      ord1.driver_id = 'D_driver_1';
      ord1.status = 'accepted';

      const ord2 = await createOrder({
        id: 'ord-reserve-2002',
        customer_id: custId,
        pickup_address: '預約搭乘起點',
        pickup_lat: 25.047,
        pickup_lng: 121.517,
      });
      ord2.driver_id = 'D_driver_2';
      ord2.status = 'accepted';

      const result = await resolveOrderForCommunication(custId, '與司機溝通 #2002');
      expect(result.needsDisambiguation).toBe(false);
      expect(result.targetOrder?.id).toBe('ord-reserve-2002');
    });

    it('forwardMessageToPassenger 應使用簡化格式（僅司機留言、司機暱稱與訊息內容）並自動開啟乘客溝通 session', async () => {
      const custId = 'U_msg_cust_99';
      const driverId = 'D_driver_mike';

      await upsertDriver({
        line_user_id: driverId,
        display_name: 'Mike Wang / Work',
        plate_number: 'CEQ-7710',
        car_brand: 'Kia Stonic',
        car_color: '綠色',
        notes: '禁菸',
        registered: true,
      });

      const ord = await createOrder({
        id: 'ord-test-5e36',
        customer_id: custId,
        pickup_address: '內湖高中',
        pickup_lat: 25.075,
        pickup_lng: 121.590,
      });
      ord.driver_id = driverId;
      ord.status = 'accepted';

      expect(isCustomerInChatSession(custId)).toBe(false);

      const pushed = await forwardMessageToPassenger(ord, driverId, '你在哪');
      expect(pushed).toBe(true);

      const mockClient = getLineClient();
      expect(mockClient.pushMessage).toHaveBeenCalledWith({
        to: custId,
        messages: [
          {
            type: 'text',
            text: '💬【司機留言】Mike Wang / Work\n\n「你在哪」',
          },
        ],
      });

      // 應自動為乘客開啟溝通 session
      expect(isCustomerInChatSession(custId)).toBe(true);
      expect(getCustomerChatOrderId(custId)).toBe(ord.id);
    });

    it('forwardMessageToDriver 應正確推播乘客留言給接單司機', async () => {
      const custId = 'U_msg_cust_99';
      const driverId = 'D_driver_mike';

      const ord = await createOrder({
        id: 'ord-test-5e36',
        customer_id: custId,
        pickup_address: '內湖高中',
        pickup_lat: 25.075,
        pickup_lng: 121.590,
      });
      ord.driver_id = driverId;
      ord.status = 'accepted';

      const pushed = await forwardMessageToDriver(ord, '快到了');
      expect(pushed).toBe(true);

      const mockClient = getLineClient();
      expect(mockClient.pushMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          to: driverId,
          messages: [
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('快到了'),
            }),
          ],
        })
      );
    });
  });

  describe('Reservation Reminder Service', () => {
    it('預約時間大於 1 小時之訂單，不應發送提醒且不納入司機 activeTrip', async () => {
      const driverId = 'D_driver_sched_1';
      const farFutureDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 小時後

      const order = await createOrder({
        id: 'ord-future-sched',
        customer_id: 'U_cust_sched',
        pickup_address: '故宮博物院',
        pickup_lat: 25.102,
        pickup_lng: 121.548,
        scheduled_time: farFutureDate,
      });
      order.driver_id = driverId;
      order.status = 'accepted';

      // 檢查是否納入司機 scheduled 清單，但不納入 active 清單
      const activeTrip = await getActiveOrderByDriverId(driverId);
      expect(activeTrip).toBeNull();

      const scheduledTrips = await getScheduledOrdersByDriverId(driverId);
      expect(scheduledTrips).toHaveLength(1);
      expect(scheduledTrips[0].id).toBe('ord-future-sched');

      // 執行定時掃描，因為距離大於 1 小時，不應觸發提醒
      const remindersSent = await checkAndSendReservationReminders();
      expect(remindersSent).toBe(0);
      expect(order.note?.includes('[REMINDER_SENT]')).toBeFalsy();
    });

    it('預約時間小於等於 60 分鐘之訂單，應自動發送提醒並標記 [REMINDER_SENT]', async () => {
      const driverId = 'D_driver_sched_2';
      const nearFutureDate = new Date(Date.now() + 45 * 60 * 1000); // 45 分鐘後

      const order = await createOrder({
        id: 'ord-near-sched',
        customer_id: 'U_cust_sched_2',
        pickup_address: '台北 101 大樓',
        pickup_lat: 25.033,
        pickup_lng: 121.564,
        scheduled_time: nearFutureDate,
      });
      order.driver_id = driverId;
      order.status = 'accepted';

      // 執行定時掃描
      const remindersSent = await checkAndSendReservationReminders();
      expect(remindersSent).toBe(1);
      expect(order.note).toContain('[REMINDER_SENT]');

      // 再次執行定時掃描，已有標記不應重複發送
      const secondCheck = await checkAndSendReservationReminders();
      expect(secondCheck).toBe(0);
    });

    it('即時單優先原則：若同時有即時單與預約單，getActiveOrderByCustomerId 應以即時單優先', async () => {
      const custId = 'U_dual_order_user';

      // 1. 預約單 (3 小時後)
      const resOrder = await createOrder({
        id: 'ord-res-future',
        customer_id: custId,
        pickup_address: '桃園機場第二航廈',
        pickup_lat: 25.077,
        pickup_lng: 121.232,
        scheduled_time: new Date(Date.now() + 3 * 60 * 60 * 1000),
      });
      resOrder.status = 'accepted';
      resOrder.driver_id = 'D_driver_res';

      // 2. 即時單 (現在要車，無 scheduled_time)
      const instantOrder = await createOrder({
        id: 'ord-instant-now',
        customer_id: custId,
        pickup_address: '信義誠品',
        pickup_lat: 25.040,
        pickup_lng: 121.565,
      });
      instantOrder.status = 'accepted';
      instantOrder.driver_id = 'D_driver_inst';

      const activeOrder = await getActiveOrderByCustomerId(custId);
      expect(activeOrder).not.toBeNull();
      expect(activeOrder?.id).toBe('ord-instant-now');
    });

    it('預約單排程邏輯：前 10 小時跳出、每 30 分鐘重跳一次、出發前 1 小時無人接單則轉為 no_driver', async () => {
      const scheduledTime = new Date(Date.now() + 12 * 60 * 60 * 1000);
      const scheduledText = formatScheduledTime(scheduledTime);
      const order = await createOrder({
        id: 'ord-lifecycle-10h',
        customer_id: 'U_cust_10h',
        pickup_address: '松山機場',
        pickup_lat: 25.063,
        pickup_lng: 121.551,
        scheduled_time: scheduledTime,
        note: `預約時間: ${scheduledText}`,
      });

      // 1. 距離上車 11 小時 (> 10h)：不廣播
      const res11h = await processReservationLifecycle(
        new Date(scheduledTime.getTime() - 11 * 60 * 60 * 1000)
      );
      expect(res11h.broadcastedCount).toBe(0);
      expect(order.status).toBe('pending');

      // 2. 距離上車 10 小時：首次跳出廣播並進入 dispatching
      const tMinus10h = new Date(scheduledTime.getTime() - 10 * 60 * 60 * 1000);
      const res10h = await processReservationLifecycle(tMinus10h);
      expect(res10h.broadcastedCount).toBe(1);
      expect(order.status).toBe('dispatching');

      // 3. 15 分鐘後 (< 30 分鐘)：不重複跳出
      const res9h45m = await processReservationLifecycle(
        new Date(tMinus10h.getTime() + 15 * 60 * 1000)
      );
      expect(res9h45m.broadcastedCount).toBe(0);

      // 4. 30 分鐘後：無人接單且未取消，再次跳出廣播
      const res9h30m = await processReservationLifecycle(
        new Date(tMinus10h.getTime() + 30 * 60 * 1000)
      );
      expect(res9h30m.broadcastedCount).toBe(1);

      // 5. 出發前 1 小時仍無司機接單：轉為 no_driver 並通知客人
      const res1h = await processReservationLifecycle(
        new Date(scheduledTime.getTime() - 60 * 60 * 1000)
      );
      expect(res1h.cutoffNoDriverCount).toBe(1);
      expect(order.status).toBe('no_driver');
    });

    it('司機接預約單後須按「我知道了」才於前 1 小時發送出車通知；逾 1 小時未按則管理員可重啟找其他司機', async () => {
      const now = new Date();
      const scheduledTime = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 小時後出發
      const scheduledText = formatScheduledTime(scheduledTime);
      const order = await createOrder({
        id: 'ord-ack-reopen',
        customer_id: 'U_cust_ack',
        pickup_address: '台北車站',
        pickup_lat: 25.047,
        pickup_lng: 121.517,
        scheduled_time: scheduledTime,
        note: `預約時間: ${scheduledText}`,
      });
      order.driver_id = 'D_driver_unacked';
      order.status = 'accepted';

      const acceptedTime = new Date(now.getTime());
      await markReservationAwaitingDriverAck(order.id, acceptedTime);

      // 未滿 1 小時前，管理員重啟應被拒絕
      const earlyReopen = await reopenReservationOrder(order.id, {
        now: new Date(acceptedTime.getTime() + 20 * 60 * 1000),
      });
      expect(earlyReopen.success).toBe(false);

      // 超過 1 小時未按「我知道了」，管理員可成功重啟找其他司機
      const validReopen = await reopenReservationOrder(order.id, {
        now: new Date(acceptedTime.getTime() + 61 * 60 * 1000),
      });
      expect(validReopen.success).toBe(true);
      expect(order.driver_id).toBeNull();
      expect(order.status).toBe('dispatching');

      // 第二位司機接單並按下「我知道了」
      order.driver_id = 'D_driver_acked';
      order.status = 'accepted';
      await markReservationAwaitingDriverAck(order.id, now);
      const ackRes = await acknowledgeReservationOrder(order.id, 'D_driver_acked', now);
      expect(ackRes.success).toBe(true);

      // 已按「我知道了」後，管理員不可再重啟
      const blockedReopen = await reopenReservationOrder(order.id, {
        now: new Date(now.getTime() + 90 * 60 * 1000),
      });
      expect(blockedReopen.success).toBe(false);

      // 當時間進入預約單前 1 小時（例如出發前 45 分鐘），系統自動向該司機 1:1 OA 發送出車通知與訂單卡片
      const tMinus45m = new Date(scheduledTime.getTime() - 45 * 60 * 1000);
      const remindersSent = await checkAndSendReservationReminders(tMinus45m);
      expect(remindersSent).toBe(1);
      expect(order.note).toContain('[REMINDER_SENT]');
    });

    it('getActiveReservationOrdersByCustomerId 應僅回傳客人正在進行中的預約單（「我的預約」查詢）', async () => {
      const custId = 'U_my_reservations';
      await createOrder({
        id: 'ord-instant-only',
        customer_id: custId,
        pickup_address: '即時單上車點',
        pickup_lat: 25.033,
        pickup_lng: 121.551,
      });

      const resTime = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const resText = formatScheduledTime(resTime);
      await createOrder({
        id: 'ord-my-res-1',
        customer_id: custId,
        pickup_address: '預約單上車點',
        pickup_lat: 25.047,
        pickup_lng: 121.517,
        scheduled_time: resTime,
        note: `預約時間: ${resText}`,
      });

      const myReservations = await getActiveReservationOrdersByCustomerId(custId);
      expect(myReservations).toHaveLength(1);
      expect(myReservations[0].id).toBe('ord-my-res-1');
    });
  });
});
