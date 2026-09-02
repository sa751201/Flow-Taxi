/**
 * 解析群組或 1:1 文字登記範本，例如：
 * 
 * 駕駛：凱開
 * 車型：toyota cc
 * 車號：9808
 * 車色：藍灰
 */
export interface ParsedDriverText {
  displayName?: string;
  carBrand?: string;
  plateNumber?: string;
  carColor?: string;
  phone?: string;
}

export function parseDriverRegistrationText(text: string): ParsedDriverText | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result: ParsedDriverText = {};

  let matchedFields = 0;

  for (const line of lines) {
    // 駕駛 / 司機 / 姓名
    const nameMatch = line.match(/^(?:駕駛|司機|姓名|名字)\s*[:：]\s*(.+)$/i);
    if (nameMatch) {
      result.displayName = nameMatch[1].trim();
      matchedFields++;
      continue;
    }

    // 車型 / 廠牌
    const brandMatch = line.match(/^(?:車型|廠牌|車款)\s*[:：]\s*(.+)$/i);
    if (brandMatch) {
      result.carBrand = brandMatch[1].trim();
      matchedFields++;
      continue;
    }

    // 車號 / 車牌
    const plateMatch = line.match(/^(?:車號|車牌|車牌號碼)\s*[:：]\s*(.+)$/i);
    if (plateMatch) {
      result.plateNumber = plateMatch[1].trim();
      matchedFields++;
      continue;
    }

    // 車色 / 顏色
    const colorMatch = line.match(/^(?:車色|顏色)\s*[:：]\s*(.+)$/i);
    if (colorMatch) {
      result.carColor = colorMatch[1].trim();
      matchedFields++;
      continue;
    }

    // 電話 / 手機
    const phoneMatch = line.match(/^(?:電話|手機|聯絡電話)\s*[:：]\s*(.+)$/i);
    if (phoneMatch) {
      result.phone = phoneMatch[1].trim();
      continue;
    }
  }

  // 至少吻合車號與另一項資訊才視為意圖登記
  if (result.plateNumber && matchedFields >= 2) {
    return result;
  }

  return null;
}
