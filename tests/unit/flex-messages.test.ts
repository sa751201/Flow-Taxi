import { describe, it, expect } from 'vitest';
import {
  createGroupOrderAssignedFlexMessage,
  createGroupOrderWonFlexMessage,
  createDriverOrderCardFlexMessage,
  createGroupOrderCancelledFlexMessage,
  createPassengerReservationConfirmedFlexMessage,
  createDriverReservationOrderCardFlexMessage,
} from '../../src/services/flex-messages.js';

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

  it('createDriverReservationOrderCardFlexMessage 應呈現預約時間、上車點與出發前一小時提醒', () => {
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
  });
});


