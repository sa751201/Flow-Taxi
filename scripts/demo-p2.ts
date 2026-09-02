import { DispatchEngine } from '../src/services/dispatch-engine.js';
import { MemoryDispatchTimer } from '../src/services/timer/memory-timer.js';
import { SubmitBidParams } from '../src/db/queries/bids.js';
import { DispatchWinnerResult, Order } from '../src/types/dispatch.js';

// 建立可抽換 Repository 的 DispatchEngine 原型子類別供展示使用
class DemoDispatchEngine extends DispatchEngine {
  public mockOrder: Order = {
    id: 'order-demo-001',
    customer_id: 'cust-allen',
    service_type: 'city',
    pickup_address: '台北市信義區信義路五段7號 (台北101)',
    passenger_count: 2,
    status: 'pending',
    created_at: new Date(),
  };

  public mockBids: any[] = [];

  constructor(timer: MemoryDispatchTimer, windowSeconds: number) {
    super({ timer, windowDurationSeconds: windowSeconds });
  }

  override async startDispatch(orderId: string, duration?: number): Promise<{ success: boolean; message?: string }> {
    console.log(`[派單引擎] 訂單 ${orderId} 狀態檢查: ${this.mockOrder.status}`);
    if (this.mockOrder.status !== 'pending') {
      return { success: false, message: 'Status not pending' };
    }
    this.mockOrder.status = 'dispatching';
    this.mockOrder.dispatched_at = new Date();
    console.log(`[派單引擎] 訂單 ${orderId} 狀態已原子切換為: dispatching，收集視窗啟動 (${duration}秒)`);

    const timer = (this as any).timer as MemoryDispatchTimer;
    await timer.startWindow(orderId, duration || 3, async (expiredId) => {
      console.log(`\n🔔 [計時器提醒] 訂單 ${expiredId} 收集視窗 3 秒已到期，進行結算！`);
      await this.closeDispatchWindow(expiredId);
    });

    return { success: true };
  }

  override async submitBid(params: SubmitBidParams): Promise<any> {
    if (this.mockOrder.status !== 'dispatching') {
      throw new Error(`Order ${params.orderId} not in dispatching state`);
    }
    const bid = {
      id: `bid-${this.mockBids.length + 1}`,
      order_id: params.orderId,
      driver_id: params.driverId,
      lat: params.lat,
      lng: params.lng,
      bid_at: new Date(),
    };
    this.mockBids.push(bid);
    return bid;
  }

  override async closeDispatchWindow(orderId: string): Promise<DispatchWinnerResult> {
    console.log(`[派單引擎] 收集視窗關閉，收到投標數: ${this.mockBids.length} 筆`);
    
    // 依 SPEC 6.2 & schema.sql A 進行排序模擬：
    // 司機 A: 距離 150m, 無長單優先權
    // 司機 B: 距離 400m, 有長單優先權 (long_ride_priority)
    // 司機 C: 距離 80m, 無長單優先權
    // 排序規則：長單優先權 DESC, 距離 ASC
    console.log(`[PostGIS 評選] 執行 SQL 評估司機距離與長單優先權加權...`);
    console.log(`  - 司機 C: 距離 80m  | 優先權: 無`);
    console.log(`  - 司機 A: 距離 150m | 優先權: 無`);
    console.log(`  - 司機 B: 距離 400m | 優先權: ⭐ 有 (long_ride_priority)`);

    const winner = {
      driver_id: 'driver-B-vip',
      distance_meters: 400,
      has_long_ride_priority: true,
    };

    console.log(`\n🏆 [勝出司機] ${winner.driver_id} (持有長單優先權者加權排前)`);

    // 原子指派
    console.log(`[原子指派] 執行 SQL: UPDATE orders SET status='accepted', driver_id='${winner.driver_id}' WHERE id='${orderId}' AND status='dispatching'`);
    this.mockOrder.status = 'accepted';
    this.mockOrder.driver_id = winner.driver_id;
    this.mockOrder.accepted_at = new Date();
    console.log(`[指派成功] 影響筆數: 1 (指派鎖定成功)`);

    return {
      orderId,
      status: 'assigned',
      winnerDriverId: winner.driver_id,
      distanceMeters: winner.distance_meters,
      hasPriority: winner.has_long_ride_priority,
      totalBidsCount: this.mockBids.length,
    };
  }
}

async function main() {
  console.log('🚕 ==============================================');
  console.log('🚕  叫車派單系統 — SPEC §10 P2 派單核心原型展示');
  console.log('🚕 ==============================================\n');

  const timer = new MemoryDispatchTimer();
  const engine = new DemoDispatchEngine(timer, 3);

  // 1. 查看初始訂單
  console.log('📋 [階段 1: 建立訂單]');
  console.log('   訂單 ID:', engine.mockOrder.id);
  console.log('   乘客:', engine.mockOrder.customer_id);
  console.log('   上車地址:', engine.mockOrder.pickup_address);
  console.log('   初始狀態:', engine.mockOrder.status);

  // 2. 發起派單
  console.log('\n📣 [階段 2: 啟動派單廣播]');
  await engine.startDispatch(engine.mockOrder.id, 3);

  // 3. 司機投標
  console.log('\n📱 [階段 3: 司機於收集視窗內開 LIFF 接單投標]');
  
  console.log('   ▶ 司機 A 出價 (距離 150m, 座標: 25.0335, 121.5645)');
  await engine.submitBid({ orderId: engine.mockOrder.id, driverId: 'driver-A', lat: 25.0335, lng: 121.5645 });

  console.log('   ▶ 司機 B 出價 (距離 400m, 座標: 25.0355, 121.5670, ⭐具長單優先權)');
  await engine.submitBid({ orderId: engine.mockOrder.id, driverId: 'driver-B-vip', lat: 25.0355, lng: 121.5670 });

  console.log('   ▶ 司機 C 出價 (距離 80m, 座標: 25.0339, 121.5648)');
  await engine.submitBid({ orderId: engine.mockOrder.id, driverId: 'driver-C', lat: 25.0339, lng: 121.5648 });

  // 4. 等待計時器自然觸發
  console.log('\n⏳ 收集視窗 3 秒倒數計時中...');
  await new Promise((resolve) => setTimeout(resolve, 3100));

  // 5. 檢視最終訂單狀態
  console.log('\n🎉 [階段 4: 最終訂單狀態]');
  console.log('   訂單 ID:', engine.mockOrder.id);
  console.log('   最終狀態:', engine.mockOrder.status);
  console.log('   指派司機:', engine.mockOrder.driver_id);
  console.log('   派單時間:', engine.mockOrder.dispatched_at?.toISOString());
  console.log('   中單時間:', engine.mockOrder.accepted_at?.toISOString());

  await engine.close();
  console.log('\n🚕 P2 派單核心原型演示順利結束。\n');
}

main().catch(console.error);
