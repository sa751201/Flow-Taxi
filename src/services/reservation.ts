/**
 * 預約用車時間解析與狀態輔助服務
 */

export interface ParsedReservation {
  date: Date | null;
  isReservation: boolean;
  formattedText: string;
}

/**
 * 解析使用者輸入的乘車時間字串
 * 支援格式：
 * - 2026/10/22 19:20 / 2026-10-22 19:20
 * - 10/22 19:20 / 10-22 19:20 / 10月22日 19:20
 * - 19:20 / 晚上 7:20 / 下午 7:20
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

  // 1. 完整西元年格式：2026/10/22 19:20 或 2026-10-22 19:20 或 2026.10.22 19:20
  const fullYearMatch = cleaned.match(/(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})[日號\s]+(?:[上下]午\s*)?(\d{1,2})[:：點](\d{1,2})/);
  if (fullYearMatch) {
    let year = parseInt(fullYearMatch[1], 10);
    let month = parseInt(fullYearMatch[2], 10) - 1;
    let day = parseInt(fullYearMatch[3], 10);
    let hour = parseInt(fullYearMatch[4], 10);
    let minute = parseInt(fullYearMatch[5], 10);

    if (cleaned.includes('下午') || cleaned.includes('晚上')) {
      if (hour < 12) hour += 12;
    } else if (cleaned.includes('上午') || cleaned.includes('早上')) {
      if (hour === 12) hour = 0;
    }

    targetDate = new Date(year, month, day, hour, minute, 0);
  }

  // 2. 無年份的月日格式：10/22 19:20 或 10-22 19:20 或 10月22日 19:20
  if (!targetDate) {
    const monthDayMatch = cleaned.match(/(\d{1,2})[\/\-\.月](\d{1,2})[日號\s]+(?:[上下]午\s*)?(\d{1,2})[:：點](\d{1,2})/);
    if (monthDayMatch) {
      let month = parseInt(monthDayMatch[1], 10) - 1;
      let day = parseInt(monthDayMatch[2], 10);
      let hour = parseInt(monthDayMatch[3], 10);
      let minute = parseInt(monthDayMatch[4], 10);

      if (cleaned.includes('下午') || cleaned.includes('晚上')) {
        if (hour < 12) hour += 12;
      } else if (cleaned.includes('上午') || cleaned.includes('早上')) {
        if (hour === 12) hour = 0;
      }

      let year = currentYear;
      const candidate = new Date(year, month, day, hour, minute, 0);
      // 若計算出的日期在過去超過 7 天，可能指明年的此時
      if (candidate.getTime() < now.getTime() - 7 * 86400000) {
        year += 1;
      }
      targetDate = new Date(year, month, day, hour, minute, 0);
    }
  }

  // 3. 只有時間格式：今天/明天 19:20 或 19:20
  if (!targetDate) {
    const timeOnlyMatch = cleaned.match(/(?:(今天|明天|後天)\s*)?(?:([上下]午|晚上|早上)\s*)?(\d{1,2})[:：點](\d{1,2})/);
    if (timeOnlyMatch) {
      const dayOffsetStr = timeOnlyMatch[1];
      const periodStr = timeOnlyMatch[2];
      let hour = parseInt(timeOnlyMatch[3], 10);
      let minute = parseInt(timeOnlyMatch[4], 10);

      if ((periodStr === '下午' || periodStr === '晚上' || cleaned.includes('下午') || cleaned.includes('晚上')) && hour < 12) {
        hour += 12;
      } else if ((periodStr === '上午' || periodStr === '早上') && hour === 12) {
        hour = 0;
      }

      let baseDay = new Date(now);
      if (dayOffsetStr === '明天') {
        baseDay.setDate(baseDay.getDate() + 1);
      } else if (dayOffsetStr === '後天') {
        baseDay.setDate(baseDay.getDate() + 2);
      } else if (!dayOffsetStr) {
        // 若只寫 19:20 且比現在早，推測為明天
        const testDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
        if (testDate.getTime() < now.getTime() - 15 * 60000) {
          baseDay.setDate(baseDay.getDate() + 1);
        }
      }

      targetDate = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), hour, minute, 0);
    }
  }

  // 4. 原生 Date.parse 兜底
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
  } else if (order.note && order.note.includes('預約時間:')) {
    const parsed = parseScheduledTimeString(order.note.replace('預約時間:', '').trim(), now);
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
