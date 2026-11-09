import { describe, it, expect } from 'vitest';
import {
  parseScheduledTimeString,
  formatScheduledTime,
  isFutureReservation,
  evaluateReservationDispatchAction,
  canAdminReopenUnacknowledgedReservation,
} from '../../src/services/reservation.js';

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

  it('應能正確解析使用者截圖的無分鐘中文格式：2026/10/14 上午9點', () => {
    const result = parseScheduledTimeString('2026/10/14 上午9點', mockNow);
    expect(result).not.toBeNull();
    expect(result!.isReservation).toBe(true);
    expect(result!.date?.getFullYear()).toBe(2026);
    expect(result!.date?.getMonth()).toBe(9); // 10月
    expect(result!.date?.getDate()).toBe(14);
    expect(result!.date?.getHours()).toBe(9);
    expect(result!.date?.getMinutes()).toBe(0);
    expect(result!.formattedText).toBe('2026/10/14 09:00');
  });

  it('支援中文時間格式：10/14 下午3點半', () => {
    const result = parseScheduledTimeString('10/14 下午3點半', mockNow);
    expect(result).not.toBeNull();
    expect(result!.isReservation).toBe(true);
    expect(result!.date?.getMonth()).toBe(9);
    expect(result!.date?.getDate()).toBe(14);
    expect(result!.date?.getHours()).toBe(15);
    expect(result!.date?.getMinutes()).toBe(30);
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

  it('evaluateReservationDispatchAction：上車前 10 小時出現、每 30 分鐘重跳、出發前 1 小時無司機結單', () => {
    const scheduledTime = new Date('2026-10-13T12:00:00+08:00');

    // 1. 距離上車 12 小時 (> 10 小時) ➔ wait_for_10h
    const tMinus12h = new Date(scheduledTime.getTime() - 12 * 60 * 60 * 1000);
    expect(
      evaluateReservationDispatchAction({ scheduled_time: scheduledTime }, tMinus12h)
    ).toBe('wait_for_10h');

    // 2. 距離上車 10 小時且尚未廣播過 ➔ broadcast_now
    const tMinus10h = new Date(scheduledTime.getTime() - 10 * 60 * 60 * 1000);
    expect(
      evaluateReservationDispatchAction({ scheduled_time: scheduledTime }, tMinus10h)
    ).toBe('broadcast_now');

    // 3. 剛廣播完 15 分鐘 (< 30 分鐘) ➔ wait_next_30m
    const tMinus9h45m = new Date(tMinus10h.getTime() + 15 * 60 * 1000);
    expect(
      evaluateReservationDispatchAction(
        { scheduled_time: scheduledTime, last_broadcast_at: tMinus10h.getTime() },
        tMinus9h45m
      )
    ).toBe('wait_next_30m');

    // 4. 距離上次廣播滿 30 分鐘 ➔ broadcast_now
    const tMinus9h30m = new Date(tMinus10h.getTime() + 30 * 60 * 1000);
    expect(
      evaluateReservationDispatchAction(
        { scheduled_time: scheduledTime, last_broadcast_at: tMinus10h.getTime() },
        tMinus9h30m
      )
    ).toBe('broadcast_now');

    // 5. 出發前 1 小時 (<= 60 分鐘) 仍無司機接單 ➔ cutoff_no_driver
    const tMinus1h = new Date(scheduledTime.getTime() - 60 * 60 * 1000);
    expect(
      evaluateReservationDispatchAction(
        { scheduled_time: scheduledTime, last_broadcast_at: tMinus9h30m.getTime() },
        tMinus1h
      )
    ).toBe('cutoff_no_driver');
  });

  it('canAdminReopenUnacknowledgedReservation：司機接單逾 1 小時未按「我知道了」時應允許管理員重啟', () => {
    const acceptedAt = new Date('2026-10-12T10:00:00+08:00').getTime();
    const order = {
      status: 'accepted',
      driver_id: 'D_DRIVER_1',
      note: `預約時間: 2026/10/12 18:00 [WAIT_DRIVER_ACK] [ACCEPTED_AT:${acceptedAt}]`,
    };

    // 30 分鐘後：未滿 1 小時，不可重啟
    expect(
      canAdminReopenUnacknowledgedReservation(order, new Date(acceptedAt + 30 * 60 * 1000))
    ).toBe(false);

    // 61 分鐘後：滿 1 小時且未按我知道了，可重啟
    expect(
      canAdminReopenUnacknowledgedReservation(order, new Date(acceptedAt + 61 * 60 * 1000))
    ).toBe(true);

    // 若已按「我知道了」([DRIVER_ACK])，即使超過 1 小時也不可重啟
    const ackedOrder = {
      ...order,
      note: `預約時間: 2026/10/12 18:00 [DRIVER_ACK] [ACCEPTED_AT:${acceptedAt}]`,
    };
    expect(
      canAdminReopenUnacknowledgedReservation(ackedOrder, new Date(acceptedAt + 90 * 60 * 1000))
    ).toBe(false);
  });
});
