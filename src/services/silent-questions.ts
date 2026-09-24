import fs from 'fs';
import path from 'path';
import pkg from 'xlsx';
import { messagingApi } from '@line/bot-sdk';

const { readFile, utils } = pkg;

export interface SilentQuestionRule {
  keyword: string;
  category: string;
  notifyAdmin: boolean;
  note?: string;
}

export interface SilentCheckResult {
  isSilent: boolean;
  matchedKeyword?: string;
  category?: string;
  notifyAdmin?: boolean;
}

// 預設靜默問題規則清單（當尚未建立 Excel 頁籤時之保底清單）
const DEFAULT_SILENT_RULES: SilentQuestionRule[] = [
  { keyword: '客訴', category: '客戶投訴', notifyAdmin: true, note: '司機服務態度、車況投訴' },
  { keyword: '投訴', category: '客戶投訴', notifyAdmin: true, note: '投訴事件' },
  { keyword: '抱怨', category: '客戶投訴', notifyAdmin: true, note: '意見反應' },
  { keyword: '遺失物', category: '遺失物品', notifyAdmin: true, note: '車上遺留物品' },
  { keyword: '遺失', category: '遺失物品', notifyAdmin: true, note: '車上遺留物品' },
  { keyword: '失物', category: '遺失物品', notifyAdmin: true, note: '車上遺留物品' },
  { keyword: '掉東西', category: '遺失物品', notifyAdmin: true, note: '車上遺失隨身物品' },
  { keyword: '退費', category: '款項問題', notifyAdmin: true, note: '款項或扣款異議' },
  { keyword: '多扣錢', category: '款項問題', notifyAdmin: true, note: '收費爭議' },
  { keyword: '找真人', category: '人工請求', notifyAdmin: true, note: '要求真人客服介入' },
  { keyword: '找客服', category: '人工請求', notifyAdmin: true, note: '要求真人客服介入' },
  { keyword: '轉人工', category: '人工請求', notifyAdmin: true, note: '要求真人客服介入' },
  { keyword: '人工服務', category: '人工請求', notifyAdmin: true, note: '要求真人客服介入' },
  { keyword: '統編報帳', category: '商務需求', notifyAdmin: true, note: '開立發票統編需求' },
  { keyword: '包月', category: '商務需求', notifyAdmin: true, note: '特殊長期包車合作' },
];

// 執行階段動態增修之暫存清單
let runtimeRules: SilentQuestionRule[] = [...DEFAULT_SILENT_RULES];

/**
 * 從 Excel 參數表「靜默問題清單」讀取自訂關鍵字規則
 */
export function loadSilentRulesFromExcel(): SilentQuestionRule[] {
  const excelPath = path.resolve(process.cwd(), 'config/派單系統參數表.xlsx');
  if (!fs.existsSync(excelPath)) {
    return runtimeRules;
  }

  try {
    const wb = readFile(excelPath);
    const sheetName = '靜默問題清單';
    if (!wb.SheetNames.includes(sheetName)) {
      return runtimeRules;
    }

    const ws = wb.Sheets[sheetName];
    const rawData: any[][] = utils.sheet_to_json(ws, { header: 1 });

    const loaded: SilentQuestionRule[] = [];
    // 跳過表頭，假設欄位為: [關鍵字, 分類, 是否通知幹部, 備註]
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !row[0]) continue;

      const keyword = String(row[0]).trim();
      const category = String(row[1] || '未分類').trim();
      const notifyAdmin = String(row[2] || '是').trim() !== '否';
      const note = String(row[3] || '').trim();

      if (keyword) {
        loaded.push({ keyword, category, notifyAdmin, note });
      }
    }

    if (loaded.length > 0) {
      runtimeRules = loaded;
    }
  } catch (err: any) {
    console.warn('[Silent Questions] 讀取 Excel 靜默問題清單失敗，使用預設規則:', err.message);
  }

  return runtimeRules;
}

/**
 * 檢查使用者傳來的文字是否命中「靜默問題」
 */
export function checkSilentQuestion(text: string): SilentCheckResult {
  if (!text) return { isSilent: false };

  const normalized = text.toLowerCase().trim();

  for (const rule of runtimeRules) {
    if (normalized.includes(rule.keyword.toLowerCase())) {
      return {
        isSilent: true,
        matchedKeyword: rule.keyword,
        category: rule.category,
        notifyAdmin: rule.notifyAdmin,
      };
    }
  }

  return { isSilent: false };
}

/**
 * 取得目前生效的所有靜默問題關鍵字
 */
export function getSilentRules(): SilentQuestionRule[] {
  return runtimeRules;
}

/**
 * 動態新增靜默關鍵字
 */
export function addSilentKeyword(keyword: string, category: string = '自訂', notifyAdmin: boolean = true): void {
  const trimmed = keyword.trim();
  if (!trimmed) return;
  if (!runtimeRules.some((r) => r.keyword === trimmed)) {
    runtimeRules.push({ keyword: trimmed, category, notifyAdmin });
  }
}

/**
 * 動態移除靜默關鍵字
 */
export function removeSilentKeyword(keyword: string): boolean {
  const initialLength = runtimeRules.length;
  runtimeRules = runtimeRules.filter((r) => r.keyword !== keyword.trim());
  return runtimeRules.length < initialLength;
}

/**
 * 當乘客命中靜默關鍵字時，產生給「幹部群組」的提醒 Flex Message
 */
export function createSilentAlertForAdmin(params: {
  passengerName: string;
  passengerUserId: string;
  messageText: string;
  matchedKeyword: string;
  category?: string;
}): messagingApi.FlexMessage {
  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#7f1d1d', // 深紅警戒色
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '⚠️【真人客服進線提醒】',
          color: '#f87171',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `命中靜默關鍵字：${params.matchedKeyword}（${params.category || '未分類'}）`,
          color: '#ffffff',
          size: 'xs',
          margin: 'sm',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '18px',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '👤 發言乘客：', color: '#64748b', size: 'sm', flex: 3 },
            { type: 'text', text: params.passengerName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 7 },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#f8fafc',
          paddingAll: '12px',
          cornerRadius: '8px',
          contents: [
            { type: 'text', text: '💬 乘客原始訊息：', color: '#64748b', size: 'xs', weight: 'bold' },
            { type: 'text', text: params.messageText, color: '#0f172a', size: 'sm', wrap: true, margin: 'xs' },
          ],
        },
        {
          type: 'text',
          text: '💡 機器人已保持靜默，未自動回覆該乘客。請幹部登入 LINE 官方帳號後台 (OA Manager) 直接手動回覆！',
          color: '#b91c1c',
          size: 'xs',
          wrap: true,
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `⚠️【真人客服提醒】乘客提到「${params.matchedKeyword}」，請至後台回覆`,
    contents: container,
  };
}
