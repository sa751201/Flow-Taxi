import { describe, it, expect } from 'vitest';
import {
  createWelcomeServiceMessage,
  createGroupDispatchOrderFlexMessage,
  createGroupOrderAssignedFlexMessage,
  createGroupOrderWonFlexMessage,
  createDriverOrderCardFlexMessage,
  createGroupOrderCancelledFlexMessage,
  createPassengerReservationConfirmedFlexMessage,
  createDriverReservationOrderCardFlexMessage,
  createCustomerReservationStatusFlexMessage,
  createDriverBoardedFareConfirmFlexMessage,
  createGroupOrderCompletedFlexMessage,
  createDriverShortTripPendingFlexMessage,
  createAdminShortTripVerifyFlexMessage,
  buildDispatchCopyText,
} from '../../src/services/flex-messages.js';
import {
  createRegularCustomer,
  matchRegularCustomerRoute,
  memoryRegularCustomers,
} from '../../src/db/queries/regular-customers.js';
import { createOrder } from '../../src/db/queries/orders.js';
import { evaluateShortTripOnCompletion } from '../../src/services/short-trip-verifier.js';

describe('createWelcomeServiceMessage', () => {
  it('OA 服務選單應顯示代駕計費說明「10公里700元，超過1公里，每公里50元。」且 Quick Reply 不應包含「搬運服務」選項', () => {
    const msg = createWelcomeServiceMessage();
    expect(msg.text).toContain('10公里700元，超過1公里，每公里50元。');
    const labels = (msg.quickReply?.items || []).map((item: any) => item.action?.label);
    expect(labels).toContain('市區搭乘🚗');
    expect(labels).toContain('機場預約✈️');
    expect(labels).toContain('酒後代駕🍺');
    expect(labels).toContain('代購代送🛍️');
    expect(labels).toContain('包車服務🚙');
    expect(labels.some((l: string) => l?.includes('搬運'))).toBe(false);
  });
});

describe('createGroupDispatchOrderFlexMessage', () => {
  it('群組廣播派單卡片右上角應顯示「30秒搶單中」', () => {
    const flexMsg = createGroupDispatchOrderFlexMessage({
      orderId: 'order-30s',
      pickupAddress: '台北101',
      dropoffAddress: '台北車站',
      passengerCount: 1,
      bidUrl: 'https://example.com/bid',
    });

    const bubble = flexMsg.contents as any;
    expect(JSON.stringify(bubble.header)).toContain('30秒搶單中');
    expect(JSON.stringify(bubble.header)).not.toContain('60秒搶單中');
  });

  it('若使用者沒有詳細下車地址（如空白或僅填行政區「台北市信義區」），接單卡片不應顯示金額', () => {
    const flexNoDropoff = createGroupDispatchOrderFlexMessage({
      orderId: 'order-no-dropoff',
      pickupAddress: '台北101',
      dropoffAddress: '台北市信義區',
      passengerCount: 1,
      estimatedFare: 200,
      bidUrl: 'https://example.com/bid',
    });

    const serialized = JSON.stringify(flexNoDropoff.contents);
    expect(serialized).not.toContain('預估車資');
    expect(serialized).not.toContain('$200');
  });

  it('派單 Flex Message 應增加第二個按鈕「複製派單資訊」（含上車地點、下車地點、指定路線，點擊後觸發已複製 tooltip）', () => {
    const flexMsg = createGroupDispatchOrderFlexMessage({
      orderId: 'order-copy-1',
      pickupAddress: '迪化街水門',
      dropoffAddress: '南港展覽館',
      passengerCount: 1,
      estimatedFare: 300,
      fareBreakdown: '常客固定金額｜固定路線：走市民高架',
      fixedRoute: '走市民高架',
      bidUrl: 'https://example.com/bid',
    });

    const bubble = flexMsg.contents as any;
    const buttons = bubble.body.contents.filter((c: any) => c.type === 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    // 第一個按鈕：立刻接單
    expect(buttons[0].action.label).toBe('⚡ 立刻接單 (測算時間)');

    // 第二個按鈕：複製派單資訊 (LINE 原生 clipboard action，點擊即複製並顯示「已複製」tooltip)
    const copyBtn = buttons[1];
    expect(copyBtn.action.type).toBe('clipboard');
    expect(copyBtn.action.label).toBe('📋 複製派單資訊');
    expect(copyBtn.action.clipboardText).toBe(
      buildDispatchCopyText({
        pickupAddress: '迪化街水門',
        dropoffAddress: '南港展覽館',
        fixedRoute: '走市民高架',
      })
    );
    expect(copyBtn.action.clipboardText).toContain('🟢 上車地點：迪化街水門');
    expect(copyBtn.action.clipboardText).toContain('🔴 下車地點：南港展覽館');
    expect(copyBtn.action.clipboardText).toContain('🛣️ 指定路線：走市民高架');
  });
});

describe('常客固定上下車地點、固定金額與固定路線比對', () => {
  it('當客人上下車地點皆與常客設定相符時回傳固定金額與固定路線；任一不符合時回傳 null 改以正常費率計算', async () => {
    memoryRegularCustomers.clear();

    await createRegularCustomer({
      id: 'reg-test-1',
      customer_id: 'U_REGULAR_VIP',
      customer_name: '王小姐',
      pickup_address: '迪化街水門',
      dropoff_address: '南港展覽館',
      fixed_fare: 300,
      fixed_route: '走市民高架',
    });

    // 1. 上下車地點完全相符 -> 命中固定金額與固定路線
    const matched = await matchRegularCustomerRoute({
      customerId: 'U_REGULAR_VIP',
      pickupAddress: '迪化街水門',
      dropoffAddress: '南港展覽館',
    });
    expect(matched).not.toBeNull();
    expect(matched?.fixed_fare).toBe(300);
    expect(matched?.fixed_route).toBe('走市民高架');

    // 2. 下車地點不符合 -> 回傳 null（以正常費率計算）
    const mismatchDropoff = await matchRegularCustomerRoute({
      customerId: 'U_REGULAR_VIP',
      pickupAddress: '迪化街水門',
      dropoffAddress: '台北車站',
    });
    expect(mismatchDropoff).toBeNull();

    // 3. 上車地點不符合 -> 回傳 null（以正常費率計算）
    const mismatchPickup = await matchRegularCustomerRoute({
      customerId: 'U_REGULAR_VIP',
      pickupAddress: '大稻埕碼頭',
      dropoffAddress: '南港展覽館',
    });
    expect(mismatchPickup).toBeNull();
  });
});

describe('createGroupOrderWonFlexMessage', () => {
  it('群組接單訊息應僅提示是誰接到單，下方附帶 ghost button 開啟 1:1 OA', () => {
    const flexMsg = createGroupOrderWonFlexMessage({
      driverName: '林大雄',
      oaUrl: 'https://lin.ee/AOp42u7',
    });

    const bubble = flexMsg.contents as any;
    expect(bubble.size).toBe('kilo');

    // 檢查 Header 提示是誰接到單
    const headerTexts = bubble.header.contents.map((c: any) => c.text);
    expect(headerTexts).toContain('🚕【派單已結單】');
    expect(headerTexts).toContain('恭喜 @林大雄 成功接單！');

    // 檢查 Body 不包含詳細地址與路線等隱私資訊，僅有引導與 ghost button
    const bodyButtons = bubble.body.contents.filter((c: any) => c.type === 'button');
    expect(bodyButtons).toHaveLength(1);

    const ghostBtn = bodyButtons[0];
    expect(ghostBtn.style).toBe('link'); // Ghost Button (無邊框透明底樣式)
    expect(ghostBtn.action.type).toBe('uri');
    expect(ghostBtn.action.label).toBe('💬 開啟 1:1 OA 查看訂單與回報');
    expect(ghostBtn.action.uri).toBe('https://lin.ee/AOp42u7');
  });

  it('提供 orderId 或 checkUrl 時，群組已結單按鈕應導向身分驗證頁（攔截非接單駕駛彈出未接單 Pop-up，不直接導向 OA）', () => {
    const flexMsg = createGroupOrderWonFlexMessage({
      driverName: '林大雄',
      orderId: 'order-won-999',
      winnerDriverId: 'U_DRIVER_WINNER',
      checkUrl: 'https://liff.line.me/123456/driver/bid?orderId=order-won-999&mode=check_won',
      oaUrl: 'https://line.me/R/ti/p/@688muuaw',
    });

    const bubble = flexMsg.contents as any;
    const bodyButtons = bubble.body.contents.filter((c: any) => c.type === 'button');
    expect(bodyButtons).toHaveLength(1);
    expect(bodyButtons[0].action.uri).toBe(
      'https://liff.line.me/123456/driver/bid?orderId=order-won-999&mode=check_won'
    );
  });
});

describe('createDriverOrderCardFlexMessage', () => {
  it('1:1 OA 司機確認接單卡片應包含上車/下車地址、Google Maps 導航按鈕與回報到點按鈕', () => {
    const pickupAddress = '台北車站';
    const dropoffAddress = '中和烘爐地';

    const flexMsg = createDriverOrderCardFlexMessage({
      driverName: 'Mike Wang',
      orderId: 'order-123',
      pickupAddress,
      dropoffAddress,
      passengerCount: 1,
      etaMinutes: 13,
    });

    const bubble = flexMsg.contents as any;
    const bodyContents = bubble.body.contents;
    
    // 找出所有 uri 按鈕
    const uriButtons = bodyContents.filter(
      (item: any) => item.type === 'button' && item.action?.type === 'uri'
    );

    expect(uriButtons).toHaveLength(2);

    // 第一個按鈕：前往上車地點（起點自動為司機手機定位，終點為上車點）
    expect(uriButtons[0].action.label).toBe('📍 前往上車地點');
    expect(uriButtons[0].action.uri).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickupAddress)}&travelmode=driving`
    );

    // 第二個按鈕：開啟下車地點定位（起點為上車點，終點為下車點）
    expect(uriButtons[1].action.label).toBe('📍 開啟下車地點定位');
    expect(uriButtons[1].action.uri).toBe(
      `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pickupAddress)}&destination=${encodeURIComponent(dropoffAddress)}&travelmode=driving`
    );

    // 第三個按鈕（通知按鈕）：我已到達上車點
    const arrivalButton = bodyContents.find(
      (item: any) => item.type === 'button' && item.action?.type === 'message'
    );
    expect(arrivalButton).toBeDefined();
    expect(arrivalButton.action.label).toBe('🔔 我已到達上車點 (通知乘客)');
    expect(arrivalButton.action.text).toBe('到');
  });

  it('若未提供下車地點，不應顯示下車地點定位按鈕', () => {
    const pickupAddress = '台北車站';

    const flexMsg = createGroupOrderAssignedFlexMessage({
      driverName: 'Mike Wang',
      orderId: 'order-123',
      pickupAddress,
      dropoffAddress: null,
      passengerCount: 1,
      etaMinutes: 13,
    });

    const bubble = flexMsg.contents as any;
    const bodyContents = bubble.body.contents;
    
    const uriButtons = bodyContents.filter(
      (item: any) => item.type === 'button' && item.action?.type === 'uri'
    );

    expect(uriButtons).toHaveLength(1);
    expect(uriButtons[0].action.label).toBe('📍 前往上車地點');
  });
});

describe('createGroupOrderCancelledFlexMessage', () => {
  it('群組聊天室取消卡片應正確呈現取消標題、訂單編號、上車點與提醒司機無須搶單文案', () => {
    const flexMsg = createGroupOrderCancelledFlexMessage({
      orderId: 'order-cancel-9876',
      pickupAddress: '台北故宮博物院',
      dropoffAddress: '台北車站',
    });

    expect(flexMsg.type).toBe('flex');
    expect(flexMsg.altText).toContain('❌【訂單已取消】');
    expect(flexMsg.altText).toContain('#9876');

    const bubble = flexMsg.contents as any;
    expect(bubble.size).toBe('kilo');

    // Header 醒目紅字與訂單編號
    const headerTexts = bubble.header.contents.map((c: any) => c.text);
    expect(headerTexts).toContain('❌【訂單已取消】');
    expect(headerTexts).toContain('訂單編號 #9876');

    // Body 上下車點與提示
    const bodyContents = bubble.body.contents;
    const addressBox = bodyContents[0];
    const addressTexts = addressBox.contents.map((c: any) => c.text);
    expect(addressTexts).toContain('🟢 上車：台北故宮博物院');
    expect(addressTexts).toContain('🔴 下車：台北車站');

    const reminderText = bodyContents[2].text;
    expect(reminderText).toContain('⚠️ 乘客已取消此筆叫車，請各位司機夥伴無須搶單。感謝配合！');
  });
});

describe('Reservation Flex Messages', () => {
  it('createPassengerReservationConfirmedFlexMessage 應正確呈現預約時間、司機車牌與用車前一小時提醒', () => {
    const flex = createPassengerReservationConfirmedFlexMessage({
      orderId: 'res-9999',
      scheduledTimeText: '2026/10/22 19:20',
      pickupAddress: '台北科技大學新生門口',
      dropoffAddress: '桃園機場',
      driverName: '林大雄',
      carBrand: 'TOYOTA CAMRY',
      plateNumber: '8888-TD',
    });

    expect(flex.type).toBe('flex');
    expect(flex.altText).toContain('2026/10/22 19:20');
    const bubble = flex.contents as any;
    expect(bubble.size).toBe('mega');
    expect(JSON.stringify(bubble)).toContain('用車前 1 小時');
    expect(JSON.stringify(bubble)).toContain('台北科技大學新生門口');
    expect(JSON.stringify(bubble)).toContain('8888-TD');
  });

  it('createDriverReservationOrderCardFlexMessage 應呈現預約時間、上車點、「我知道了」確認按鈕與出發前一小時提醒', () => {
    const flex = createDriverReservationOrderCardFlexMessage({
      orderId: 'res-9999',
      driverName: '林大雄',
      scheduledTimeText: '2026/10/22 19:20',
      pickupAddress: '台北科技大學新生門口',
      dropoffAddress: '桃園機場',
    });

    expect(flex.type).toBe('flex');
    expect(flex.altText).toContain('2026/10/22 19:20');
    const bubble = flex.contents as any;
    expect(JSON.stringify(bubble)).toContain('出發前 1 小時');
    expect(JSON.stringify(bubble)).toContain('預先查看路線');
    expect(JSON.stringify(bubble)).toContain('我知道了');
    expect(JSON.stringify(bubble)).toContain('action=ack_reservation&orderId=res-9999');
  });

  it('createGroupOrderWonFlexMessage 若為預約單 (isReservation: true)，應包含「我知道了」確認按鈕', () => {
    const flex = createGroupOrderWonFlexMessage({
      driverName: '林大雄',
      orderId: 'res-9999',
      isReservation: true,
    });

    const bubble = flex.contents as any;
    expect(JSON.stringify(bubble)).toContain('我知道了');
    expect(JSON.stringify(bubble)).toContain('action=ack_reservation&orderId=res-9999');
  });

  it('createCustomerReservationStatusFlexMessage（「我的預約」）應顯示正在進行的預約單與是否接單狀態', () => {
    const flex = createCustomerReservationStatusFlexMessage([
      {
        orderId: 'res-1111',
        scheduledTimeText: '2026/10/22 19:20',
        pickupAddress: '台北車站',
        dropoffAddress: '松山機場',
        status: 'dispatching',
        isAccepted: false,
      },
      {
        orderId: 'res-2222',
        scheduledTimeText: '2026/10/23 09:00',
        pickupAddress: '信義誠品',
        dropoffAddress: '桃園機場',
        status: 'accepted',
        isAccepted: true,
        driverAcknowledged: true,
        driverName: '林大雄',
        carBrand: 'TOYOTA CAMRY',
        plateNumber: 'TDC-8888',
        carColor: '黑色',
      },
    ]);

    expect(flex.type).toBe('flex');
    const serialized = JSON.stringify(flex.contents);
    expect(serialized).toContain('尚未接單');
    expect(serialized).toContain('已接單');
    expect(serialized).toContain('林大雄');
    expect(serialized).toContain('TDC-8888');
  });
});

describe('客上金額確認與群組結單回報 Flex Messages', () => {
  it('createDriverBoardedFareConfirmFlexMessage 應顯示訂單資訊、訂單金額，並包含「確認金額並回報」與「調整訂單金額並回報」按鈕', () => {
    const flexMsg = createDriverBoardedFareConfirmFlexMessage({
      orderId: 'order-fare-8888',
      pickupAddress: '台北 101',
      dropoffAddress: '松山機場',
      fare: 320,
      adjustFareUrl: 'https://example.com/driver/adjust-fare?orderId=order-fare-8888',
    });

    expect(flexMsg.type).toBe('flex');
    expect(flexMsg.altText).toContain('$320');
    const bubble = flexMsg.contents as any;
    const serialized = JSON.stringify(bubble);
    expect(serialized).toContain('台北 101');
    expect(serialized).toContain('松山機場');
    expect(serialized).toContain('$320');

    const bodyButtons = bubble.body.contents.filter((c: any) => c.type === 'button');
    expect(bodyButtons).toHaveLength(2);

    // 確認金額並回報
    expect(bodyButtons[0].action.type).toBe('postback');
    expect(bodyButtons[0].action.label).toBe('確認金額並回報');
    expect(bodyButtons[0].action.data).toContain('action=confirm_fare_complete&orderId=order-fare-8888&fare=320');

    // 調整訂單金額並回報
    expect(bodyButtons[1].action.type).toBe('uri');
    expect(bodyButtons[1].action.label).toBe('調整訂單金額並回報');
    expect(bodyButtons[1].action.uri).toBe('https://example.com/driver/adjust-fare?orderId=order-fare-8888');
  });

  it('當使用者沒有詳細下車地址 (fare 為 null) 時，createDriverBoardedFareConfirmFlexMessage 不顯示預估金額並要求下車必填金額', () => {
    const flexMsg = createDriverBoardedFareConfirmFlexMessage({
      orderId: 'order-no-addr-9999',
      pickupAddress: '台北車站',
      dropoffAddress: null,
      fare: null,
      adjustFareUrl: 'https://example.com/driver/adjust-fare?orderId=order-no-addr-9999',
    });

    const bubble = flexMsg.contents as any;
    const serialized = JSON.stringify(bubble);
    expect(serialized).toContain('下車時金額必填');
    expect(serialized).not.toContain('$100');

    const bodyButtons = bubble.body.contents.filter((c: any) => c.type === 'button');
    expect(bodyButtons).toHaveLength(1);
    expect(bodyButtons[0].action.type).toBe('uri');
    expect(bodyButtons[0].action.label).toBe('填寫訂單金額並回報');
    expect(bodyButtons[0].action.uri).toBe('https://example.com/driver/adjust-fare?orderId=order-no-addr-9999');
  });

  it('createGroupOrderCompletedFlexMessage 應顯示「這筆訂單已完結」、結單金額與調整備註（若有）', () => {
    const flexMsg = createGroupOrderCompletedFlexMessage({
      orderId: 'order-fare-8888',
      driverName: '林大雄',
      pickupAddress: '台北 101',
      dropoffAddress: '松山機場',
      fare: 380,
      isAdjusted: true,
      adjustNote: '乘客臨時繞道買咖啡',
    });

    expect(flexMsg.type).toBe('flex');
    expect(flexMsg.altText).toContain('這筆訂單已完結');
    expect(flexMsg.altText).toContain('$380');

    const serialized = JSON.stringify(flexMsg.contents);
    expect(serialized).toContain('這筆訂單已完結');
    expect(serialized).toContain('林大雄');
    expect(serialized).toContain('$380');
    expect(serialized).toContain('乘客臨時繞道買咖啡');
  });

  it('派單卡片不應再顯示「回報為短距離單」按鈕；結單回報偵測小於 5 公里時，應產生司機短程單提示與管理員核實 Flex Message', async () => {
    const dispatchFlex = createGroupDispatchOrderFlexMessage({
      orderId: 'order-no-short-btn',
      pickupAddress: '台北車站',
      dropoffAddress: null,
      bidUrl: 'https://example.com/bid',
      shortTripUrl: 'https://example.com/short-trip',
    });
    expect(JSON.stringify(dispatchFlex.contents)).not.toContain('回報為短距離單');

    const driverShortFlex = createDriverShortTripPendingFlexMessage({
      orderId: 'order-short-1234',
      pickupAddress: '台北車站',
      dropoffAddress: '西門町捷運站',
      distanceKm: 2.3,
      fare: 120,
    });
    expect(JSON.stringify(driverShortFlex.contents)).toContain('系統計算為短程單');
    expect(JSON.stringify(driverShortFlex.contents)).toContain('補單點數');

    const adminVerifyFlex = createAdminShortTripVerifyFlexMessage({
      orderId: 'order-short-1234',
      driverId: 'U_DRIVER_SHORT',
      driverName: '林大雄',
      pickupAddress: '台北車站',
      dropoffAddress: '西門町捷運站',
      distanceKm: 2.3,
      fare: 120,
    });
    const adminJson = JSON.stringify(adminVerifyFlex.contents);
    expect(adminJson).toContain('短程單待管理員核實');
    expect(adminJson).toContain('action=admin_verify_short_trip&orderId=order-short-1234&driverId=U_DRIVER_SHORT&approved=1');
    expect(adminJson).toContain('action=admin_verify_short_trip&orderId=order-short-1234&driverId=U_DRIVER_SHORT&approved=0');

    // 驗證 evaluateShortTripOnCompletion：小於 5 公里應判定為短程單
    const shortOrder = await createOrder({
      id: 'order-eval-short',
      customer_id: 'U_CUST_1',
      pickup_address: '台北車站',
      pickup_lat: 25.0478,
      pickup_lng: 121.517,
      dropoff_address: '西門町捷運站',
      distance_km: 2.4,
      fare: 120,
    });
    const evalRes = await evaluateShortTripOnCompletion({ order: shortOrder });
    expect(evalRes.isShortTrip).toBe(true);
    expect(evalRes.distanceKm).toBe(2.4);
  });
});



