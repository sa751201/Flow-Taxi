import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startCustomerChatSession,
  endCustomerChatSession,
  isCustomerInChatSession,
  getCustomerChatOrderId,
  resolveOrderForCommunication,
} from '../../src/services/order-chat.js';
import {
  createOrder,
  getActiveOrderByCustomerId,
  getScheduledOrdersByDriverId,
  getActiveOrderByDriverId,
  memoryOrders,
} from '../../src/db/queries/orders.js';
import { checkAndSendReservationReminders } from '../../src/services/reservation-reminder.js';

describe('Order Chat & Reservation Reminder Tests', () => {
  beforeEach(() => {
    memoryOrders.clear();
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
  });
});
