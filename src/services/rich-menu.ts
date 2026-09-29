import { getLineClient } from './line-client.js';
import { env } from '../config/env.js';

/**
 * 司機與乘客 Rich Menu (圖文選單) 管理服務
 * 
 * LINE Messaging API 支援：
 * 1. 預設圖文選單 (Default Rich Menu)：適用於所有一般使用者與乘客。
 * 2. 用戶綁定圖文選單 (Per-User Linked Rich Menu)：適用於特定已驗證/已註冊的司機。
 *    透過 API 將司機專屬的 Rich Menu ID 綁定到司機的 LINE User ID，
 *    該司機在 1:1 OA 就會看到司機專屬工作台（上線/待命、當前任務、到點回報、客上回報、下車結單、車籍修改）。
 */

/**
 * 為指定司機綁定專屬的司機 Rich Menu
 */
export async function linkDriverRichMenu(userId: string, richMenuId?: string): Promise<boolean> {
  const targetMenuId = richMenuId || env.DRIVER_RICH_MENU_ID;
  if (!targetMenuId) {
    console.log(`[RichMenu] 未設定 DRIVER_RICH_MENU_ID，略過司機 ${userId} 的 Rich Menu 綁定。`);
    return false;
  }

  try {
    const lineClient = getLineClient();
    await lineClient.linkRichMenuIdToUser(userId, targetMenuId);
    console.log(`[RichMenu] ✅ 成功為司機 ${userId} 綁定專屬 Rich Menu: ${targetMenuId}`);
    return true;
  } catch (err: any) {
    console.warn(`[RichMenu] ⚠️ 綁定司機 ${userId} Rich Menu 失敗:`, err.message);
    return false;
  }
}

/**
 * 解除用戶的專屬 Rich Menu 綁定（將自動回退至預設的乘客選單）
 */
export async function unlinkDriverRichMenu(userId: string): Promise<boolean> {
  try {
    const lineClient = getLineClient();
    await lineClient.unlinkRichMenuIdFromUser(userId);
    console.log(`[RichMenu] ✅ 成功解除用戶 ${userId} 的專屬 Rich Menu，已回退至預設選單。`);
    return true;
  } catch (err: any) {
    console.warn(`[RichMenu] ⚠️ 解除用戶 ${userId} Rich Menu 失敗:`, err.message);
    return false;
  }
}

/**
 * 查詢指定用戶目前綁定的 Rich Menu ID
 */
export async function getUserRichMenuId(userId: string): Promise<string | null> {
  try {
    const lineClient = getLineClient();
    const res = await lineClient.getRichMenuIdOfUser(userId);
    return res.richMenuId || null;
  } catch {
    return null;
  }
}

/**
 * 司機專用 Rich Menu 結構範本 (6格設計，尺寸 2500x1686 或 2500x843)
 * 可直接複製至 LINE Official Account Manager 或透過 API 建立
 */
export function getDriverRichMenuTemplate() {
  return {
    size: {
      width: 2500,
      height: 1686,
    },
    selected: true,
    name: '司機專屬工作台選單',
    chatBarText: '🚕 司機工作台',
    areas: [
      // 左上：目前行程 / 導航
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: {
          type: 'message',
          label: '目前行程',
          text: '目前行程',
        },
      },
      // 中上：回報到達上車點
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: {
          type: 'message',
          label: '到點回報',
          text: '到',
        },
      },
      // 右上：回報客上
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: {
          type: 'message',
          label: '客上回報',
          text: '客上',
        },
      },
      // 左下：下車結單
      {
        bounds: { x: 0, y: 843, width: 833, height: 843 },
        action: {
          type: 'message',
          label: '下車結單',
          text: '乘客下車',
        },
      },
      // 中下：司機車籍資料維護
      {
        bounds: { x: 833, y: 843, width: 834, height: 843 },
        action: {
          type: 'message',
          label: '車籍資料',
          text: '修改資料',
        },
      },
      // 右下：聯繫幹部 / 客服
      {
        bounds: { x: 1667, y: 843, width: 833, height: 843 },
        action: {
          type: 'message',
          label: '聯繫幹部',
          text: '找客服',
        },
      },
    ],
  };
}
