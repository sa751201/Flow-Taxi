import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DispatchEngine } from '../../src/services/dispatch-engine.js';
import { MemoryDispatchTimer } from '../../src/services/timer/memory-timer.js';
import * as orderQueries from '../../src/db/queries/orders.js';
import * as bidQueries from '../../src/db/queries/bids.js';
import * as dispatchQueries from '../../src/db/queries/dispatch.js';

describe('DispatchEngine Unit Tests', () => {
  let timer: MemoryDispatchTimer;
  let engine: DispatchEngine;

  beforeEach(() => {
    timer = new MemoryDispatchTimer();
    engine = new DispatchEngine({ timer, windowDurationSeconds: 2 });
  });

  afterEach(async () => {
    await engine.close();
    vi.restoreAllMocks();
  });

  describe('startDispatch', () => {
    it('應成功將 pending 訂單變更為 dispatching 並啟動收集視窗', async () => {
      vi.spyOn(orderQueries, 'getOrderById').mockResolvedValue({
        id: 'order-1',
        customer_id: 'cust-1',
        service_type: 'city',
        pickup_address: '台北車站',
        passenger_count: 1,
        status: 'pending',
        created_at: new Date(),
      });

      const markDispatchingSpy = vi.spyOn(orderQueries, 'markOrderDispatching').mockResolvedValue(true);
      const timerStartSpy = vi.spyOn(timer, 'startWindow');

      const result = await engine.startDispatch('order-1', 60);

      expect(result.success).toBe(true);
      expect(markDispatchingSpy).toHaveBeenCalledWith('order-1');
      expect(timerStartSpy).toHaveBeenCalledWith('order-1', 60, expect.any(Function));
    });

    it('若訂單非 pending 狀態，應拒絕發起派單', async () => {
      vi.spyOn(orderQueries, 'getOrderById').mockResolvedValue({
        id: 'order-2',
        customer_id: 'cust-1',
        service_type: 'city',
        pickup_address: '台北車站',
        passenger_count: 1,
        status: 'dispatching',
        created_at: new Date(),
      });

      const result = await engine.startDispatch('order-2');
      expect(result.success).toBe(false);
      expect(result.message).toContain("status is 'dispatching'");
    });
  });

  describe('submitBid', () => {
    it('若訂單處於 dispatching 狀態，應允許司機投標', async () => {
      vi.spyOn(orderQueries, 'getOrderById').mockResolvedValue({
        id: 'order-1',
        customer_id: 'cust-1',
        service_type: 'city',
        pickup_address: '台北車站',
        passenger_count: 1,
        status: 'dispatching',
        created_at: new Date(),
      });

      const mockBid = {
        id: 'bid-1',
        order_id: 'order-1',
        driver_id: 'driver-1',
        distance_to_pickup_km: 1.2,
        bid_at: new Date(),
      };
      vi.spyOn(bidQueries, 'insertBid').mockResolvedValue(mockBid);

      const bid = await engine.submitBid({
        orderId: 'order-1',
        driverId: 'driver-1',
        lat: 25.0478,
        lng: 121.517,
      });

      expect(bid.id).toBe('bid-1');
      expect(bid.driver_id).toBe('driver-1');
    });

    it('若訂單非 dispatching 狀態，應拋出錯誤', async () => {
      vi.spyOn(orderQueries, 'getOrderById').mockResolvedValue({
        id: 'order-1',
        customer_id: 'cust-1',
        service_type: 'city',
        pickup_address: '台北車站',
        passenger_count: 1,
        status: 'accepted',
        created_at: new Date(),
      });

      await expect(
        engine.submitBid({
          orderId: 'order-1',
          driverId: 'driver-1',
          lat: 25.0478,
          lng: 121.517,
        })
      ).rejects.toThrow('is not in dispatching state');
    });
  });

  describe('closeDispatchWindow', () => {
    it('若無人投標，應將訂單標記為 no_driver', async () => {
      vi.spyOn(bidQueries, 'getBidsByOrderId').mockResolvedValue([]);
      const noDriverSpy = vi.spyOn(dispatchQueries, 'markOrderNoDriver').mockResolvedValue(true);

      const result = await engine.closeDispatchWindow('order-empty');

      expect(result.status).toBe('no_driver');
      expect(result.totalBidsCount).toBe(0);
      expect(noDriverSpy).toHaveBeenCalledWith('order-empty');
    });

    it('多位司機投標時，應依演算法挑選中單者並原子指派 (長單優先權加權或最近距離)', async () => {
      vi.spyOn(bidQueries, 'getBidsByOrderId').mockResolvedValue([
        { id: 'b1', order_id: 'o1', driver_id: 'd1', bid_at: new Date() },
        { id: 'b2', order_id: 'o1', driver_id: 'd2', bid_at: new Date() },
      ]);

      vi.spyOn(dispatchQueries, 'findWinnerDriver').mockResolvedValue({
        driver_id: 'd2',
        distance_meters: 550,
        has_long_ride_priority: true,
      });

      const assignSpy = vi.spyOn(dispatchQueries, 'atomicallyAssignDriver').mockResolvedValue(true);

      const result = await engine.closeDispatchWindow('o1');

      expect(result.status).toBe('assigned');
      expect(result.winnerDriverId).toBe('d2');
      expect(result.hasPriority).toBe(true);
      expect(result.distanceMeters).toBe(550);
      expect(assignSpy).toHaveBeenCalledWith('o1', 'd2');
    });

    it('若原子指派受影響筆數非 1 (併發競爭或訂單被取消)，應回傳 conflict_or_cancelled', async () => {
      vi.spyOn(bidQueries, 'getBidsByOrderId').mockResolvedValue([
        { id: 'b1', order_id: 'o1', driver_id: 'd1', bid_at: new Date() },
      ]);

      vi.spyOn(dispatchQueries, 'findWinnerDriver').mockResolvedValue({
        driver_id: 'd1',
        distance_meters: 200,
        has_long_ride_priority: false,
      });

      // 模擬指派失敗 (affectedRows !== 1)
      vi.spyOn(dispatchQueries, 'atomicallyAssignDriver').mockResolvedValue(false);

      const result = await engine.closeDispatchWindow('o1');

      expect(result.status).toBe('conflict_or_cancelled');
    });
  });

  describe('Timer Window Expiry', () => {
    it('時間到期時應自動觸發 closeDispatchWindow', async () => {
      vi.useFakeTimers();

      vi.spyOn(orderQueries, 'getOrderById').mockResolvedValue({
        id: 'order-timer',
        customer_id: 'c1',
        service_type: 'city',
        pickup_address: '大湖公園',
        passenger_count: 1,
        status: 'pending',
        created_at: new Date(),
      });
      vi.spyOn(orderQueries, 'markOrderDispatching').mockResolvedValue(true);
      const closeSpy = vi.spyOn(engine, 'closeDispatchWindow').mockResolvedValue({
        orderId: 'order-timer',
        status: 'no_driver',
        totalBidsCount: 0,
      });

      await engine.startDispatch('order-timer', 3);
      expect(timer.isWindowActive('order-timer')).toBe(true);

      // 快轉 3 秒
      vi.advanceTimersByTime(3000);

      expect(closeSpy).toHaveBeenCalledWith('order-timer');
      expect(timer.isWindowActive('order-timer')).toBe(false);

      vi.useRealTimers();
    });
  });
});
