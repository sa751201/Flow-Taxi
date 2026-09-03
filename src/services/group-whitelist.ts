import fs from 'fs';
import path from 'path';
import pkg from 'xlsx';
import { env } from '../config/env.js';

const { readFile, utils } = pkg;

export interface AllowedGroup {
  name: string;
  groupId: string;
  status: 'active' | 'inactive';
  note?: string;
}

/**
 * 從 Excel 參數表「允許群組白名單」頁籤讀取授權群組清單
 */
export function getAllowedGroups(): AllowedGroup[] {
  const allowedGroups: AllowedGroup[] = [];

  // 保底：若環境變數有 DRIVER_GROUP_ID，自動視為預設白名單
  if (env.DRIVER_GROUP_ID) {
    allowedGroups.push({
      name: '預設司機群組 (Env)',
      groupId: env.DRIVER_GROUP_ID,
      status: 'active',
      note: '來自環境變數 DRIVER_GROUP_ID',
    });
  }

  const excelPath = path.resolve(process.cwd(), 'config/派單系統參數表.xlsx');
  if (!fs.existsSync(excelPath)) {
    return allowedGroups;
  }

  try {
    const wb = readFile(excelPath);
    const sheetName = '允許群組白名單';
    if (!wb.SheetNames.includes(sheetName)) {
      return allowedGroups;
    }

    const ws = wb.Sheets[sheetName];
    // 轉為二維陣列 (跳過標題前2行)
    const rawData: any[][] = utils.sheet_to_json(ws, { header: 1 });
    
    // 第 0 列: 說明標題, 第 1 列: 欄位表頭 ['群組名稱', 'LINE Group ID', '狀態', '備註']
    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length < 2) continue;

      const name = String(row[0] || '').trim();
      const groupId = String(row[1] || '').trim();
      const status = String(row[2] || 'active').trim().toLowerCase();
      const note = String(row[3] || '').trim();

      if (groupId && groupId.startsWith('C')) {
        allowedGroups.push({
          name: name || '未命名群組',
          groupId,
          status: status === 'inactive' ? 'inactive' : 'active',
          note,
        });
      }
    }
  } catch (err: any) {
    console.warn('[Group Whitelist] 讀取參數表群組白名單失敗，使用保底名單:', err.message);
  }

  return allowedGroups;
}

/**
 * 檢查指定的 groupId 是否在參數表的啟用白名單中
 */
export function isGroupAllowed(groupId: string): boolean {
  if (!groupId) return false;
  const groups = getAllowedGroups();
  const matched = groups.find((g) => g.groupId === groupId && g.status === 'active');
  return Boolean(matched);
}
