import { describe, it, expect } from 'vitest';
import { parseDriverRegistrationText } from '../../src/services/driver-parser.js';

describe('Driver Text Registration Parser', () => {
  it('應成功解析截圖所示之司機登記範本', () => {
    const sample = `
MG&MD 優質司機
───────────────
駕駛：凱開
車型：toyota cc
車號：9808
車色：藍灰
───────────────
禁🚬 禁食
    `;

    const parsed = parseDriverRegistrationText(sample);
    expect(parsed).not.toBeNull();
    expect(parsed?.displayName).toBe('凱開');
    expect(parsed?.carBrand).toBe('toyota cc');
    expect(parsed?.plateNumber).toBe('9808');
    expect(parsed?.carColor).toBe('藍灰');
  });

  it('應支援半形冒號與標準全碼車牌', () => {
    const sample = `
司機: 林小華
車牌: RAB-6666
顏色: 黑色
廠牌: Toyota RAV4
電話: 0987654321
    `;

    const parsed = parseDriverRegistrationText(sample);
    expect(parsed).not.toBeNull();
    expect(parsed?.displayName).toBe('林小華');
    expect(parsed?.plateNumber).toBe('RAB-6666');
    expect(parsed?.carColor).toBe('黑色');
    expect(parsed?.carBrand).toBe('Toyota RAV4');
    expect(parsed?.phone).toBe('0987654321');
  });

  it('一般無關文字不應被誤判為登記範本', () => {
    const sample = '今天下午天氣真好，想去淡水走走！';
    const parsed = parseDriverRegistrationText(sample);
    expect(parsed).toBeNull();
  });
});
