import { describe, it, expect } from 'vitest';
import { createGroupOrderAssignedFlexMessage } from '../../src/services/flex-messages.js';

describe('createGroupOrderAssignedFlexMessage', () => {
  it('中單廣播卡片應包含「📍 前往上車地點」與「📍 開啟下車地點定位」按鈕，並對應正確 Google Maps 連結', () => {
    const pickupAddress = '台北車站';
    const dropoffAddress = '中和烘爐地';

    const flexMsg = createGroupOrderAssignedFlexMessage({
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
