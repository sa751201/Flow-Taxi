import { describe, it, expect } from 'vitest';
import {
  createGroupOrderAssignedFlexMessage,
  createGroupOrderWonFlexMessage,
  createDriverOrderCardFlexMessage,
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

    // 第一個按鈕：前往上車地點
    expect(uriButtons[0].action.label).toBe('📍 前往上車地點');
    expect(uriButtons[0].action.uri).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickupAddress)}`
    );

    // 第二個按鈕：開啟下車地點定位
    expect(uriButtons[1].action.label).toBe('📍 開啟下車地點定位');
    expect(uriButtons[1].action.uri).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dropoffAddress)}`
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
