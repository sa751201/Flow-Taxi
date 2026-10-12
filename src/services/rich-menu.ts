import { getLineClient } from './line-client.js';
import { env } from '../config/env.js';
import { getDriverById } from '../db/queries/drivers.js';

/**
 * 司機與乘客 Rich Menu (圖文選單) 管理服務
 * 
 * 核心原理：
 * 1. 預設圖文選單 (Default Rich Menu)：
 *    在 LINE Console 設為「預設選單」即可，所有一般乘客或新好友進來預設就看到「乘客選單」。
 * 2. 司機圖文選單 (Driver Rich Menu)：
 *    環境變數 DRIVER_RICH_MENU_ID 只需要填寫「司機圖文選單的編號」（如 richmenu-xxxx），
 *    系統會自動連線資料庫查詢使用者的身分，如果是已註冊司機，自動幫該 LINE 帳號綁定司機選單，
 *    完全不需要手動把成千上萬個司機的 User ID 寫進環境變數！
 */

export const DEFAULT_DRIVER_RICH_MENU_ID = 'richmenu-b4972e4b6feb7d86e2123b4a2a4a4375';

export function getEffectiveDriverRichMenuId(): string {
  return env.DRIVER_RICH_MENU_ID || DEFAULT_DRIVER_RICH_MENU_ID;
}

/**
 * 依據資料庫身份動態判斷並同步使用者的 Rich Menu：
 * - 資料庫中存在且 registered = true ➔ 自動指派司機 Rich Menu
 * - 非司機（一般乘客）➔ 自動確保使用預設乘客 Rich Menu（若曾綁定過司機選單則自動解除）
 */
export async function syncUserRichMenuByRole(userId: string): Promise<'driver' | 'passenger' | 'skipped'> {
  const targetMenuId = getEffectiveDriverRichMenuId();
  if (!targetMenuId) {
    return 'skipped';
  }

  try {
    const driver = await getDriverById(userId);
    if (driver && driver.registered) {
      await linkDriverRichMenu(userId);
      return 'driver';
    } else {
      const currentMenu = await getUserRichMenuId(userId);
      if (currentMenu === targetMenuId) {
        await unlinkDriverRichMenu(userId);
      }
      return 'passenger';
    }
  } catch (err: any) {
    console.warn(`[RichMenu] 自動同步用戶 ${userId} 選單身分失敗:`, err.message);
    return 'skipped';
  }
}

/**
 * 為指定司機綁定專屬的司機 Rich Menu
 */
export async function linkDriverRichMenu(userId: string, richMenuId?: string): Promise<boolean> {
  const targetMenuId = richMenuId || getEffectiveDriverRichMenuId();
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
 * 司機專用 Rich Menu 結構範本 (緊湊橫幅設計，尺寸 2500x843)
 * 左側 2/3 (0 ~ 1667): 「開啟接單程式」按鈕，連結至 Driver App
 * 右側 1/3 (1667 ~ 2500): 暫時不設定 action
 */
export function getDriverRichMenuTemplate(appUrl: string = 'https://flow-taxi-production.up.railway.app/driver/app') {
  return {
    size: {
      width: 2500,
      height: 843,
    },
    selected: true,
    name: '司機接單工作台 (開啟接單程式)',
    chatBarText: '🚕 司機接單工作台',
    areas: [
      {
        bounds: {
          x: 0,
          y: 0,
          width: 1667,
          height: 843,
        },
        action: {
          type: 'uri' as const,
          label: '開啟接單程式',
          uri: appUrl,
        },
      },
    ],
  };
}
