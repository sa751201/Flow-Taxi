import { describe, it, expect } from 'vitest';
import { parseScheduledTimeString, formatScheduledTime, isFutureReservation } from '../../src/services/reservation.js';

describe('Reservation Service', () => {
  const mockNow = new Date('2026-10-12T16:00:00+08:00');

  it('應能正確解析使用者截圖格式：2026/10/22 19:20 且判定為預約單 (> 1 小時)', () => {
    const result = parseScheduledTimeString('2026/10/22 19:20', mockNow);
    expect(result).not.toBeNull();
    expect(result!.isReservation).toBe(true);
    expect(result!.date?.getFullYear()).toBe(2026);
    expect(result!.date?.getMonth()).toBe(9); // 10月 (0-indexed)
    expect(result!.date?.getDate()).toBe(22);
    expect(result!.date?.getHours()).toBe(19);
    expect(result!.date?.getMinutes()).toBe(20);
    expect(result!.formattedText).toBe('2026/10/22 19:20');
  });

  it('若時間在現在起 1 小時內，應判定為非預約單 (即時單)', () => {
    // 現在是 16:00，預約 16:30 (30 分鐘後)
    const result = parseScheduledTimeString('2026/10/12 16:30', mockNow);
    expect(result).not.toBeNull();
    expect(result!.isReservation).toBe(false);
  });

  it('若時間在現在起 1 小時以上 (例如 17:30，90分鐘後)，應判定為預約單', () => {
    const result = parseScheduledTimeString('2026/10/12 17:30', mockNow);
    expect(result).not.toBeNull();
    expect(result!.isReservation).toBe(true);
  });

  it('支援月日格式：10/22 19:20', () => {
    const result = parseScheduledTimeString('10/22 19:20', mockNow);
    expect(result).not.toBeNull();
    expect(result!.isReservation).toBe(true);
    expect(result!.formattedText).toBe('2026/10/22 19:20');
  });

  it('支援「現在要車免填」或「免填」輸入應回傳 null', () => {
    expect(parseScheduledTimeString('現在要車免填', mockNow)).toBeNull();
    expect(parseScheduledTimeString('免填', mockNow)).toBeNull();
    expect(parseScheduledTimeString('', mockNow)).toBeNull();
  });

  it('isFutureReservation 應正確辨識未來預約單與已發出車提醒之單', () => {
    const futureOrder = {
      scheduled_time: new Date('2026-10-22T19:20:00+08:00'),
      reminder_sent: false,
    };
    expect(isFutureReservation(futureOrder, mockNow)).toBe(true);

    const remindedOrder = {
      scheduled_time: new Date('2026-10-22T19:20:00+08:00'),
      reminder_sent: true,
    };
    expect(isFutureReservation(remindedOrder, mockNow)).toBe(false);
  });
});
