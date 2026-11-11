import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/line-client.js', () => ({
  getLineClient: vi.fn(() => ({
    pushMessage: vi.fn().mockResolvedValue({}),
    replyMessage: vi.fn().mockResolvedValue({}),
    linkRichMenuIdToUser: vi.fn().mockResolvedValue({}),
    unlinkRichMenuIdFromUser: vi.fn().mockResolvedValue({}),
    getRichMenuIdOfUser: vi.fn().mockResolvedValue('richmenu-none'),
  })),
}));

import { getDriverRichMenuTemplate } from '../../src/services/rich-menu.js';
import {
  createOrder,
  getOrderById,
  updateOrderStatus,
  getActiveOrderByDriverId,
  getActiveOrderByCustomerId,
  isDetailedDropoffAddress,
  getOrderDefaultFare,
  completeOrderWithFare,
} from '../../src/db/queries/orders.js';

describe('Rich Menu & Order Status Lifecycle Tests', () => {
  describe('getDriverRichMenuTemplate', () => {
    it('司機 Rich Menu 範本應符合 LINE 規格並包含開啟接單程式 URI 動作', () => {
      const template = getDriverRichMenuTemplate();
      expect(template.size.width).toBe(2500);
      expect(template.size.height).toBe(843);
      expect(template.areas.length).toBe(1);

      const area = template.areas[0];
      expect(area.action.type).toBe('uri');
      expect((area.action as any).uri).toBe('https://flow-taxi-production.up.railway.app/driver/app');
      expect(area.bounds.width).toBe(1667);
      expect(area.bounds.height).toBe(843);
    });

    it('syncUserRichMenuByRole 應安全回傳對應身分狀態', async () => {
      const { syncUserRichMenuByRole } = await import('../../src/services/rich-menu.js');
      const res = await syncUserRichMenuByRole('test-user-random');
      expect(['skipped', 'passenger', 'driver']).toContain(res);
    });
  });

  describe('Order Status Transition: accepted -> picked_up -> done', () => {
    it('訂單應能在司機回報客上 (picked_up) 與乘客下車 (done) 時正確更新狀態與查詢活躍訂單', async () => {
      const orderId = `test-order-${Date.now()}`;
      const driverId = `driver-${Date.now()}`;
      const customerId = `cust-${Date.now()}`;

      // 1. 建立訂單
      const order = await createOrder({
        id: orderId,
        customer_id: customerId,
        pickup_address: '台北 101',
        pickup_lat: 25.033,
        pickup_lng: 121.564,
        dropoff_address: '松山機場',
        fare: 250,
      });

      expect(order.status).toBe('pending');

      // 2. 模擬接單媒合完成：指派司機
      order.driver_id = driverId;
      await updateOrderStatus(orderId, 'accepted');

      let activeOrder = await getActiveOrderByDriverId(driverId);
      expect(activeOrder).not.toBeNull();
      expect(activeOrder?.id).toBe(orderId);
      expect(activeOrder?.status).toBe('accepted');

      // 3. 司機回報「客上」：狀態變更為 picked_up
      const updatedToPickedUp = await updateOrderStatus(orderId, 'picked_up');
      expect(updatedToPickedUp).toBe(true);

      activeOrder = await getActiveOrderByDriverId(driverId);
      expect(activeOrder).not.toBeNull();
      expect(activeOrder?.status).toBe('picked_up');
      expect(activeOrder?.picked_up_at).toBeDefined();

      // 乘客端查詢仍處於進行中
      const activeForCustomer = await getActiveOrderByCustomerId(customerId);
      expect(activeForCustomer).not.toBeNull();
      expect(activeForCustomer?.id).toBe(orderId);

      // 4. 司機回報「乘客下車」：狀態變更為 done (結單)
      const updatedToDone = await updateOrderStatus(orderId, 'done');
      expect(updatedToDone).toBe(true);

      const finalOrder = await getOrderById(orderId);
      expect(finalOrder?.status).toBe('done');
      expect(finalOrder?.completed_at).toBeDefined();

      // 5. 結單後司機查無進行中活躍訂單
      activeOrder = await getActiveOrderByDriverId(driverId);
      expect(activeOrder).toBeNull();
    });

    it('乘客取消訂單時，應能正確更新狀態為 cancelled 且活躍訂單清空', async () => {
      const customerId = 'U_test_cancel_cust_' + Date.now();
      const order = await createOrder({
        customer_id: customerId,
        service_type: 'city',
        pickup_address: '故宮',
        pickup_lat: 25.1024,
        pickup_lng: 121.5485,
        dropoff_address: '台大新生校門口',
      });
      expect(order.status).toBe('pending');

      let activeForCustomer = await getActiveOrderByCustomerId(customerId);
      expect(activeForCustomer).not.toBeNull();

      // 乘客取消
      await updateOrderStatus(order.id, 'cancelled');

      const cancelledOrder = await getOrderById(order.id);
      expect(cancelledOrder?.status).toBe('cancelled');

      activeForCustomer = await getActiveOrderByCustomerId(customerId);
      expect(activeForCustomer).toBeNull();
    });

    it('completeOrderWithFare 應能確認或調整訂單金額與備註，並將訂單狀態更新為 done', async () => {
      const orderId = `test-complete-fare-${Date.now()}`;
      const driverId = `driver-fare-${Date.now()}`;
      const customerId = `cust-fare-${Date.now()}`;

      const order = await createOrder({
        id: orderId,
        customer_id: customerId,
        pickup_address: '台北車站',
        pickup_lat: 25.0478,
        pickup_lng: 121.517,
        dropoff_address: '台北 101',
        fare: 220,
      });
      order.driver_id = driverId;
      await updateOrderStatus(orderId, 'picked_up');

      expect(getOrderDefaultFare(order)).toBe(220);

      const completed = await completeOrderWithFare(orderId, 280, '夜間加成與繞道');
      expect(completed).not.toBeNull();
      expect(completed?.status).toBe('done');
      expect(completed?.fare).toBe(280);
      expect(completed?.note).toContain('夜間加成與繞道');
      expect(completed?.completed_at).toBeDefined();
    });

    it('當使用者沒有詳細下車地址時，預設金額為 null，且回報下車結單時必須填寫金額才能完成結單', async () => {
      expect(isDetailedDropoffAddress('')).toBe(false);
      expect(isDetailedDropoffAddress('台北市信義區')).toBe(false);
      expect(isDetailedDropoffAddress('乘客上車後說明')).toBe(false);
      expect(isDetailedDropoffAddress('台北市信義區松壽路12號')).toBe(true);
      expect(isDetailedDropoffAddress('台北 101')).toBe(true);

      const orderId = `test-no-dropoff-${Date.now()}`;
      const order = await createOrder({
        id: orderId,
        customer_id: `cust-no-dropoff-${Date.now()}`,
        pickup_address: '台北車站',
        pickup_lat: 25.0478,
        pickup_lng: 121.517,
      });
      await updateOrderStatus(orderId, 'picked_up');

      // 無詳細下車地址時，不提供預設金額
      expect(getOrderDefaultFare(order)).toBeNull();

      // 未填寫金額時無法直接完成結單
      const failedComplete = await completeOrderWithFare(orderId, null);
      expect(failedComplete).toBeNull();

      // 司機回報下車並填寫必填金額後，成功結單
      const completed = await completeOrderWithFare(orderId, 350);
      expect(completed).not.toBeNull();
      expect(completed?.status).toBe('done');
      expect(completed?.fare).toBe(350);
    });
  });
});
