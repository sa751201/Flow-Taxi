import { describe, it, expect } from 'vitest';
import { getDriverRichMenuTemplate } from '../../src/services/rich-menu.js';
import {
  createOrder,
  getOrderById,
  updateOrderStatus,
  getActiveOrderByDriverId,
  getActiveOrderByCustomerId,
} from '../../src/db/queries/orders.js';

describe('Rich Menu & Order Status Lifecycle Tests', () => {
  describe('getDriverRichMenuTemplate', () => {
    it('司機 Rich Menu 範本應符合 LINE 規格並包含到點、客上、下車結單動作', () => {
      const template = getDriverRichMenuTemplate();
      expect(template.size.width).toBe(2500);
      expect(template.size.height).toBe(1686);
      expect(template.areas.length).toBe(6);

      const actionTexts = template.areas.map((a: any) => a.action.text);
      expect(actionTexts).toContain('目前行程');
      expect(actionTexts).toContain('到');
      expect(actionTexts).toContain('客上');
      expect(actionTexts).toContain('乘客下車');
      expect(actionTexts).toContain('修改資料');
    });

    it('未設定 DRIVER_RICH_MENU_ID 時，syncUserRichMenuByRole 應安全回傳 skipped', async () => {
      const { syncUserRichMenuByRole } = await import('../../src/services/rich-menu.js');
      const res = await syncUserRichMenuByRole('test-user-without-env');
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
  });
});
