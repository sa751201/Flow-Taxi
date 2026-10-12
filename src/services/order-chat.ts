import { Order, getActiveOrdersByCustomerId, getOrderById } from '../db/queries/orders.js';
import { isFutureReservation } from './reservation.js';
import { getDriverById } from '../db/queries/drivers.js';
import { getLineClient } from './line-client.js';

// customerId -> orderId 映射（乘客與指定司機的通話階段）
const customerChatSessions = new Map<string, string>();

/**
 * 啟動乘客與司機的雙向溝通階段
 */
export function startCustomerChatSession(customerId: string, orderId: string): void {
  customerChatSessions.set(customerId, orderId);
}

/**
 * 結束乘客與司機的溝通階段
 */
export function endCustomerChatSession(customerId: string): boolean {
  return customerChatSessions.delete(customerId);
}

/**
 * 取得乘客目前綁定的溝通訂單 ID
 */
export function getCustomerChatOrderId(customerId: string): string | undefined {
  return customerChatSessions.get(customerId);
}

/**
 * 檢查乘客是否處於溝通階段
 */
export function isCustomerInChatSession(customerId: string): boolean {
  return customerChatSessions.has(customerId);
}

/**
 * 依據使用者輸入或有效訂單，解析溝通目標訂單
 * 支援多單消歧義檢測與「即時單優先原則」
 */
export async function resolveOrderForCommunication(
  customerId: string,
  rawText: string
): Promise<{
  targetOrder?: Order;
  ordersWithDriver: Order[];
  needsDisambiguation: boolean;
  noOrders: boolean;
  pendingOnly: boolean;
}> {
  const activeOrders = await getActiveOrdersByCustomerId(customerId);

  if (activeOrders.length === 0) {
    return {
      ordersWithDriver: [],
      needsDisambiguation: false,
      noOrders: true,
      pendingOnly: false,
    };
  }

  // 篩選已有司機接單 (accepted, in_progress, arrived, picked_up) 之訂單
  const ordersWithDriver = activeOrders.filter(
    (o) => o.driver_id && ['accepted', 'in_progress', 'arrived', 'picked_up'].includes(o.status)
  );

  if (ordersWithDriver.length === 0) {
    return {
      ordersWithDriver: [],
      needsDisambiguation: false,
      noOrders: false,
      pendingOnly: true,
    };
  }

  // 檢查文字中是否已包含指定單號後碼 (例如 #1234)
  const idMatch = rawText.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    const specifiedCode = idMatch[1].toLowerCase();
    const matched = ordersWithDriver.find(
      (o) => o.id.toLowerCase().endsWith(specifiedCode) || o.id.toLowerCase() === specifiedCode
    );
    if (matched) {
      return {
        targetOrder: matched,
        ordersWithDriver,
        needsDisambiguation: false,
        noOrders: false,
        pendingOnly: false,
      };
    }
  }

  // 若只有 1 筆已有司機接單的訂單，直接鎖定
  if (ordersWithDriver.length === 1) {
    return {
      targetOrder: ordersWithDriver[0],
      ordersWithDriver,
      needsDisambiguation: false,
      noOrders: false,
      pendingOnly: false,
    };
  }

  // 若有 2 筆以上，且使用者未指定單號 -> 需發出 Quick Reply 詢問消歧義
  return {
    ordersWithDriver,
    needsDisambiguation: true,
    noOrders: false,
    pendingOnly: false,
  };
}

/**
 * 將乘客文字轉發至接單司機 1:1 OA
 */
export async function forwardMessageToDriver(
  order: Order,
  messageText: string
): Promise<boolean> {
  if (!order.driver_id) return false;

  const lineClient = getLineClient();
  const shortId = order.id.slice(-4);
  const isRes = isFutureReservation(order);
  const orderType = isRes ? '📅 預約單' : '⚡ 即時單';

  try {
    await lineClient.pushMessage({
      to: order.driver_id,
      messages: [
        {
          type: 'text',
          text: `💬【乘客留言】（${orderType} #${shortId}）\n\n「${messageText}」\n\n（上車點：${order.pickup_address}）\n可以直接打字回覆乘客喔！`,
        },
      ],
    });
    return true;
  } catch (err: any) {
    console.error(`[Order Chat] 轉發乘客訊息至司機 ${order.driver_id} 失敗:`, err.message);
    return false;
  }
}

/**
 * 將司機文字轉發至乘客 1:1 OA
 */
export async function forwardMessageToPassenger(
  order: Order,
  driverId: string,
  messageText: string
): Promise<boolean> {
  if (!order.customer_id) return false;

  const lineClient = getLineClient();
  const driver = await getDriverById(driverId);
  const driverName = driver?.display_name || '接單司機';
  const plate = driver?.plate_number ? ` (${driver.plate_number})` : '';
  const shortId = order.id.slice(-4);

  try {
    await lineClient.pushMessage({
      to: order.customer_id,
      messages: [
        {
          type: 'text',
          text: `💬【司機留言】（${driverName}${plate}，訂單 #${shortId}）\n\n「${messageText}」\n\n您可以直接在此打字回覆司機！🚖`,
        },
      ],
    });
    return true;
  } catch (err: any) {
    console.error(`[Order Chat] 轉發司機訊息至乘客 ${order.customer_id} 失敗:`, err.message);
    return false;
  }
}
