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
 * 判斷訂單是否為「未來未到出車時間」的預約單
 * (距離預約時間 > 60 分鐘且尚未發送出車提醒)
 */
export function isFutureReservation(order: {
  scheduled_time?: Date | null;
  note?: string | null;
  reminder_sent?: boolean | null;
}, now: Date = new Date()): boolean {
  let schDate: Date | null = null;
  if (order.scheduled_time) {
    schDate = new Date(order.scheduled_time);
  } else if (order.note) {
    const raw = order.note.replace('預約時間:', '').replace('[REMINDER_SENT]', '').trim();
    const parsed = parseScheduledTimeString(raw, now);
    schDate = parsed?.date || null;
  }

  if (!schDate || isNaN(schDate.getTime())) return false;

  // 若已發送 1 小時出車提醒，視為進入常態行程，不再屬於 future reservation
  if (order.reminder_sent || (order.note && order.note.includes('[REMINDER_SENT]'))) {
    return false;
  }

  const diffMs = schDate.getTime() - now.getTime();
  return diffMs > 60 * 60 * 1000;
}
