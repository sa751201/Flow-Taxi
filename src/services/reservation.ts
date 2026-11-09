/**
 * 預約用車時間解析與狀態輔助服務
 */

export interface ParsedReservation {
  date: Date | null;
  isReservation: boolean;
  formattedText: string;
}

/**
 * 輔助解析時間字串中的小時與分鐘
 * 支援格式：上午9點, 9點, 9點半, 9點30分, 19:20, 下午3點, 晚上8點45分, 9:00 等
 */
function parseTimeComponents(timeStr: string): { hour: number; minute: number } | null {
  if (!timeStr) return null;
  const cleaned = timeStr.trim();
  const isHalf = cleaned.includes('半');
  const isPm = cleaned.includes('下午') || cleaned.includes('晚上');
  const isAm = cleaned.includes('上午') || cleaned.includes('早上');

  // 比對小時與可選的分鐘
  // 例 1: "9點30分", "9點30", "9:30", "9：30"
  // 例 2: "9點", "9點半", "9時"
  const m = cleaned.match(/(\d{1,2})(?:[:：點時]\s*(\d{1,2})?|分)?/);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  let minute = 0;

  if (m[2]) {
    minute = parseInt(m[2], 10);
  } else if (isHalf) {
    minute = 30;
  }

  // 若字串中有額外分，例如 "9點30分" 或 "30分"
  const minMatch = cleaned.match(/(\d{1,2})\s*分/);
  if (minMatch && !m[2]) {
    minute = parseInt(minMatch[1], 10);
  }

  if (isPm && hour < 12) hour += 12;
  if (isAm && hour === 12) hour = 0;

  return { hour, minute };
}

/**
 * 解析使用者輸入的乘車時間字串
 * 支援格式：
 * - 2026/10/14 上午9點 / 2026/10/14 9點 / 2026/10/22 19:20
 * - 10/14 上午9點 / 10月14日 9點半 / 10-22 19:20
 * - 明天上午9點 / 今天下午3點
 * - 上午9點 / 19:20 / 9點半
 */
export function parseScheduledTimeString(rawText?: string | null, referenceNow: Date = new Date()): ParsedReservation | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText.trim();
  if (!cleaned || cleaned.includes('現在要車免填') || cleaned === '免填' || cleaned === '現在') {
    return null;
  }

  const now = referenceNow;
  const currentYear = now.getFullYear();
  let targetDate: Date | null = null;

  // 1. 包含完整西元年格式：2026/10/14 上午9點 或 2026-10-22 19:20 或 2026年10月14日 9點
  const fullYearMatch = cleaned.match(/(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})[日號\s]*(.*)/);
  if (fullYearMatch) {
    const year = parseInt(fullYearMatch[1], 10);
    const month = parseInt(fullYearMatch[2], 10) - 1;
    const day = parseInt(fullYearMatch[3], 10);
    const timePart = fullYearMatch[4] ? fullYearMatch[4].trim() : '';

    const timeComp = timePart ? parseTimeComponents(timePart) : { hour: 9, minute: 0 };
    if (timeComp) {
      targetDate = new Date(year, month, day, timeComp.hour, timeComp.minute, 0);
    }
  }

  // 2. 無年份的月日格式：10/14 上午9點 或 10月14日 9點半 或 10-22 19:20
  if (!targetDate) {
    const monthDayMatch = cleaned.match(/(\d{1,2})[\/\-\.月](\d{1,2})[日號\s]*(.*)/);
    if (monthDayMatch) {
      const month = parseInt(monthDayMatch[1], 10) - 1;
      const day = parseInt(monthDayMatch[2], 10);
      const timePart = monthDayMatch[3] ? monthDayMatch[3].trim() : '';

      const timeComp = timePart ? parseTimeComponents(timePart) : { hour: 9, minute: 0 };
      if (timeComp) {
        let year = currentYear;
        const candidate = new Date(year, month, day, timeComp.hour, timeComp.minute, 0);
        if (candidate.getTime() < now.getTime() - 7 * 86400000) {
          year += 1;
        }
        targetDate = new Date(year, month, day, timeComp.hour, timeComp.minute, 0);
      }
    }
  }

  // 3. 今天 / 明天 / 後天
  if (!targetDate) {
    const relMatch = cleaned.match(/(今天|明天|後天)\s*(.*)/);
    if (relMatch) {
      const dayOffset = relMatch[1] === '明天' ? 1 : relMatch[1] === '後天' ? 2 : 0;
      const timePart = relMatch[2] ? relMatch[2].trim() : '';
      const timeComp = timePart ? parseTimeComponents(timePart) : null;
      if (timeComp) {
        const base = new Date(now);
        base.setDate(base.getDate() + dayOffset);
        targetDate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), timeComp.hour, timeComp.minute, 0);
      }
    }
  }

  // 4. 純時間格式 (例如 上午9點 / 9點半 / 19:20 / 下午3點)
  if (!targetDate) {
    const timeComp = parseTimeComponents(cleaned);
    if (timeComp) {
      const base = new Date(now);
      const testDate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), timeComp.hour, timeComp.minute, 0);
      if (testDate.getTime() < now.getTime() - 15 * 60000) {
        base.setDate(base.getDate() + 1);
      }
      targetDate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), timeComp.hour, timeComp.minute, 0);
    }
  }

  // 5. 原生 Date.parse 兜底
  if (!targetDate || isNaN(targetDate.getTime())) {
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      targetDate = parsed;
    }
  }

  if (!targetDate || isNaN(targetDate.getTime())) {
    return null;
  }

  // 預約單定義：日期有填且非從現在算起 1 小時內 (即距離現在 > 60 分鐘)
  const diffMs = targetDate.getTime() - now.getTime();
  const isReservation = diffMs > 60 * 60 * 1000;

  return {
    date: targetDate,
    isReservation,
    formattedText: formatScheduledTime(targetDate),
  };
}

/**
 * 格式化時間為易讀格式 (YYYY/MM/DD HH:mm)
 */
export function formatScheduledTime(dateInput: Date | string): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}

/**
 * 預約單排程時間常數
 */
export const RESERVATION_FIRST_BROADCAST_BEFORE_MS = 10 * 60 * 60 * 1000; // 上車前 10 小時首次跳出派單 Flex Message
export const RESERVATION_REBROADCAST_INTERVAL_MS = 30 * 60 * 1000; // 無人接單且未取消時，每 30 分鐘重跳一次
export const RESERVATION_NO_DRIVER_CUTOFF_BEFORE_MS = 60 * 60 * 1000; // 出發前 1 小時若仍無司機接單，通知客人無司機接單
export const RESERVATION_DRIVER_ACK_TIMEOUT_MS = 60 * 60 * 1000; // 司機接預約單後 1 小時內未按「我知道了」，管理員可重啟派單

/**
 * 萃取乾淨的預約乘車時間顯示文字（移除系統內部標記 tag）
 */
export function extractScheduledTimeText(order: {
  scheduled_time?: Date | string | null;
  note?: string | null;
}): string {
  if (order.note) {
    const cleaned = order.note
      .replace(/\[[^\]]*\]/g, '')
      .replace('預約時間:', '')
      .trim();
    if (cleaned) return cleaned;
  }
  if (order.scheduled_time) {
    return formatScheduledTime(order.scheduled_time);
  }
  return '';
}

/**
 * 取得訂單的預約時間 Date 物件
 */
export function getScheduledDate(
  order: {
    scheduled_time?: Date | string | null;
    note?: string | null;
  },
  now: Date = new Date()
): Date | null {
  if (order.scheduled_time) {
    const d = new Date(order.scheduled_time);
    if (!isNaN(d.getTime())) return d;
  }
  if (order.note) {
    const raw = extractScheduledTimeText(order);
    if (raw) {
      const parsed = parseScheduledTimeString(raw, now);
      if (parsed?.date && !isNaN(parsed.date.getTime())) {
        return parsed.date;
      }
    }
  }
  return null;
}

/**
 * 判斷訂單是否為預約單（包含未來預約或已進入出車階段之預約單）
 */
export function isReservationOrder(
  order: {
    scheduled_time?: Date | string | null;
    note?: string | null;
  },
  now: Date = new Date()
): boolean {
  const schDate = getScheduledDate(order, now);
  return Boolean(schDate);
}

/**
 * 判斷司機是否已按下「我知道了」確認承接預約單
 */
export function hasDriverAck(order: {
  note?: string | null;
  driver_acknowledged?: boolean | null;
}): boolean {
  if ((order as any).driver_acknowledged === true) return true;
  if (order.note && order.note.includes('[DRIVER_ACK]')) return true;
  return false;
}

/**
 * 判斷預約單是否處於需要司機按下「我知道了」的追蹤狀態
 */
export function requiresDriverAck(order: {
  note?: string | null;
  wait_driver_ack?: boolean | null;
}): boolean {
  if ((order as any).wait_driver_ack === true) return true;
  if (order.note && order.note.includes('[WAIT_DRIVER_ACK]')) return true;
  return false;
}

/**
 * 取得司機接下預約單的時間戳 (ms)
 */
export function getOrderAcceptedAtMs(order: {
  note?: string | null;
  accepted_at?: Date | string | number | null;
}): number | null {
  const propVal = (order as any).accepted_at;
  if (propVal) {
    const ms = typeof propVal === 'number' ? propVal : new Date(propVal).getTime();
    if (!isNaN(ms)) return ms;
  }
  if (order.note) {
    const m = order.note.match(/\[ACCEPTED_AT:(\d+)\]/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * 取得預約單上次在司機群組廣播的時間戳 (ms)
 */
export function getLastBroadcastAtMs(order: {
  note?: string | null;
  last_broadcast_at?: Date | string | number | null;
}): number | null {
  const propVal = (order as any).last_broadcast_at;
  if (propVal) {
    const ms = typeof propVal === 'number' ? propVal : new Date(propVal).getTime();
    if (!isNaN(ms)) return ms;
  }
  if (order.note) {
    const m = order.note.match(/\[LAST_BROADCAST:(\d+)\]/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * 判斷預約單是否因司機接單後超過 1 小時未按「我知道了」，而可由管理員重啟派單
 */
export function canAdminReopenUnacknowledgedReservation(
  order: {
    status?: string;
    driver_id?: string | null;
    note?: string | null;
    accepted_at?: Date | string | number | null;
    driver_acknowledged?: boolean | null;
  },
  now: Date = new Date()
): boolean {
  if (order.status !== 'accepted' || !order.driver_id) return false;
  if (hasDriverAck(order)) return false;
  const acceptedAtMs = getOrderAcceptedAtMs(order);
  if (!acceptedAtMs) return false;
  return now.getTime() - acceptedAtMs >= RESERVATION_DRIVER_ACK_TIMEOUT_MS;
}

/**
 * 判斷未接單之預約單在當前時間點的排程動作：
 * - 'wait_for_10h': 距離上車時間 > 10 小時，尚不廣播
 * - 'broadcast_now': 距離上車時間介於 1~10 小時，且（尚未廣播過 或 距離上次廣播已滿 30 分鐘）
 * - 'wait_next_30m': 距離上車時間介於 1~10 小時，但距離上次廣播未滿 30 分鐘
 * - 'cutoff_no_driver': 距離上車時間 <= 1 小時且仍無司機接單，應結單並通知客人無司機接單
 */
export function evaluateReservationDispatchAction(
  order: {
    scheduled_time?: Date | string | null;
    note?: string | null;
    last_broadcast_at?: Date | string | number | null;
  },
  now: Date = new Date()
): 'wait_for_10h' | 'broadcast_now' | 'wait_next_30m' | 'cutoff_no_driver' | 'not_reservation' {
  const schDate = getScheduledDate(order, now);
  if (!schDate) return 'not_reservation';

  const diffMs = schDate.getTime() - now.getTime();

  if (diffMs <= RESERVATION_NO_DRIVER_CUTOFF_BEFORE_MS) {
    return 'cutoff_no_driver';
  }

  if (diffMs > RESERVATION_FIRST_BROADCAST_BEFORE_MS) {
    return 'wait_for_10h';
  }

  const lastBroadcastMs = getLastBroadcastAtMs(order);
  if (!lastBroadcastMs || now.getTime() - lastBroadcastMs >= RESERVATION_REBROADCAST_INTERVAL_MS) {
    return 'broadcast_now';
  }

  return 'wait_next_30m';
}

/**
 * 判斷訂單是否為「未來未到出車時間」的預約單
 * (距離預約時間 > 60 分鐘且尚未發送出車提醒)
 */
export function isFutureReservation(order: {
  scheduled_time?: Date | null;
  note?: string | null;
  reminder_sent?: boolean | null;
}, now: Date = new Date()): boolean {
  const schDate = getScheduledDate(order, now);
  if (!schDate || isNaN(schDate.getTime())) return false;

  // 若已發送 1 小時出車提醒，視為進入常態行程，不再屬於 future reservation
  if (order.reminder_sent || (order.note && order.note.includes('[REMINDER_SENT]'))) {
    return false;
  }

  const diffMs = schDate.getTime() - now.getTime();
  return diffMs > 60 * 60 * 1000;
}
