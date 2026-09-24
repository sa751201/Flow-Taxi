import { messagingApi } from '@line/bot-sdk';
import { env } from '../config/env.js';
import { query } from '../db/index.js';

export type DispatchMode = 'auto' | 'manual';

interface AdminControlState {
  mode: DispatchMode;
  lastUpdated: string;
  updatedBy?: string;
  takeoverReason?: string;
}

// 記憶體中狀態（若無 Redis 或暫時快取）
let currentControlState: AdminControlState = {
  mode: 'auto',
  lastUpdated: new Date().toISOString(),
  updatedBy: 'system',
};

/**
 * 取得目前派單模式 ('auto' 自動叫車派單 | 'manual' 人工接管)
 */
export async function getDispatchMode(): Promise<DispatchMode> {
  return currentControlState.mode;
}

/**
 * 檢查目前是否處於人工手動接管狀態
 */
export async function isManualTakeoverActive(): Promise<boolean> {
  return currentControlState.mode === 'manual';
}

/**
 * 設定系統派單模式
 */
export async function setDispatchMode(
  mode: DispatchMode,
  updatedBy: string = 'admin',
  reason?: string
): Promise<AdminControlState> {
  currentControlState = {
    mode,
    lastUpdated: new Date().toISOString(),
    updatedBy,
    takeoverReason: reason,
  };

  console.log(`[Admin Control] 系統派單模式變更為: ${mode.toUpperCase()} (操作者: ${updatedBy})`);
  return currentControlState;
}

/**
 * 處理幹部群組輸入的控制指令
 * 回傳要回覆給幹部群組的 LINE 訊息，若非管理指令則回傳 null
 */
export async function handleAdminGroupCommand(
  text: string,
  senderName: string = '幹部'
): Promise<messagingApi.Message | null> {
  const trimmed = text.trim();

  // 1. 接管指令
  if (['接管', '切換手動', '手動接單', '手動模式', '暫停派單', '停止機器人'].includes(trimmed)) {
    await setDispatchMode('manual', senderName, '幹部手動接管');

    return {
      type: 'text',
      text: `🛑【系統已切換為人工接管模式】\n\n操作幹部：@${senderName}\n切換時間：${new Date().toLocaleTimeString('zh-TW', { hour12: false })}\n\n說明：\n1. 官方帳號已停止對乘客 1:1 的自動回覆與自動派單。\n2. 人員可直接至 LINE 官方帳號後台 (LINE OA Manager) 與乘客對話。\n3. 若要恢復自動化，請於本群組輸入「恢復」或「開啟自動」。`,
    };
  }

  // 2. 恢復指令
  if (['恢復', '切換自動', '自動接單', '自動模式', '開啟派單', '開啟機器人'].includes(trimmed)) {
    await setDispatchMode('auto', senderName, '幹部恢復自動');

    return {
      type: 'text',
      text: `🟢【系統已恢復機器人自動接單】\n\n操作幹部：@${senderName}\n恢復時間：${new Date().toLocaleTimeString('zh-TW', { hour12: false })}\n\n說明：\n1. 官方帳號即刻恢復自動辨識地址、車資試算與司機群組廣播派單。\n2. 若需隨時介入，請輸入「接管」。`,
    };
  }

  // 3. 狀態查詢指令
  if (['狀態', '查狀態', '模式', '控制中心'].includes(trimmed)) {
    const isManual = currentControlState.mode === 'manual';
    const modeBadge = isManual ? '🛑 人工接管中 (手動模式)' : '🟢 機器人派單中 (自動模式)';

    let activeOrderCount = 0;
    try {
      if (env.DATABASE_URL) {
        const res = await query(
          `SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'dispatching', 'accepted');`
        );
        activeOrderCount = Number(res.rows[0]?.count || 0);
      }
    } catch {
      // 忽視計數錯誤
    }

    return {
      type: 'text',
      text: `📊【控制中心系統狀態】\n\n• 目前模式：${modeBadge}\n• 最後更新：${new Date(currentControlState.lastUpdated).toLocaleTimeString('zh-TW', { hour12: false })} (@${currentControlState.updatedBy})\n• 進行中訂單：${activeOrderCount} 筆\n\n可用指令：\n• 輸入「接管」：停止機器人，改為人員後台手動回覆\n• 輸入「恢復」：重新啟動機器人自動回覆與派單\n• 輸入「日報」：即時產生並預覽今日營運日報`,
    };
  }

  return null;
}
