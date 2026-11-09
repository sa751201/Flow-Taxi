import { messagingApi } from '@line/bot-sdk';
import { env } from '../config/env.js';
import { isDetailedDropoffAddress } from '../db/queries/orders.js';

/**
 * 建立「司機資料登記 / 修改」的 Flex Message 卡片
 * 風格：乾淨現代白底風格，字體以黑灰深色為主，保持清晰高對比與 LINE 生態一致感
 */
export function createDriverRegisterFlexMessage(registerUrl: string): messagingApi.FlexMessage {
  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingTop: '20px',
      paddingBottom: '12px',
      paddingStart: '20px',
      paddingEnd: '20px',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: 'TAXI DISPATCH',
              color: '#d97706',
              size: 'xs',
              weight: 'bold',
            },
          ],
        },
        {
          type: 'text',
          text: '🚕 司機夥伴資料維護',
          color: '#111827',
          size: 'xl',
          weight: 'bold',
          margin: 'sm',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingStart: '20px',
      paddingEnd: '20px',
      paddingBottom: '20px',
      spacing: 'md',
      contents: [
        {
          type: 'text',
          text: '為了確保派單資訊精確與乘車辨識順暢，請司機夥伴隨時保持最新車輛資訊（姓名、車牌、車型、車色）。',
          color: '#4b5563',
          size: 'sm',
          wrap: true,
          lineSpacing: '4px',
        },
        {
          type: 'separator',
          color: '#f3f4f6',
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          margin: 'md',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#06c755', // LINE 經典品牌綠 / 醒目按鈕
              height: 'md',
              action: {
                type: 'uri',
                label: '📝 填寫登記資料',
                uri: registerUrl,
              },
            },
            {
              type: 'button',
              style: 'secondary',
              color: '#f3f4f6',
              height: 'md',
              action: {
                type: 'postback',
                label: '✏️ 修改已登記資料',
                data: 'action=check_or_edit_driver',
                displayText: '修改資料',
              },
            },
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#fafafa',
      paddingAll: '14px',
      contents: [
        {
          type: 'text',
          text: '🔒 身分由 LINE 安全驗證，資料僅供派單對接使用',
          color: '#9ca3af',
          size: 'xxs',
          align: 'center',
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: '🚕 司機夥伴資料維護與登記',
    contents: container,
  };
}

/**
 * 建立 1:1 乘客歡迎訊息與 6 大服務 Quick Reply 按鈕
 * 「市區搭乘🚗」採用 postback + fillInText + openKeyboard，點選時直接將範本帶入使用者輸入框並彈出鍵盤
 */
export function createWelcomeServiceMessage(): messagingApi.TextMessage {
  const welcomeText = `您好
歡迎您加入福露叫車平台🥇🌊

歡迎使用「預約叫車」
提早為您的行程 做好準備🌸
➖➖➖服務項目➖➖➖
🌊市區搭乘
收費方式如下👇🏻
基本費$6️⃣0️⃣元∙每公里$2️⃣0️⃣元
3️⃣公里以內1️⃣2️⃣0️⃣元。
🔺上山+1️⃣0️⃣0️⃣

🌊酒後代駕服務
10公里700元，超過1公里，每公里50元。

🔎以上費率僅限
北北基、桃園其他縣市另計。

請點選以下的符合您需求的服務，歡迎大家提早預約💎`;

  const cityRideFillIn = `1. 上車地點：
2. 下車地點：
3. 人數：
4. 乘車時間：`;

  const airportFillIn = `送機 /接機 ：
航班：（接機必填）（出國免填）
日期：
時間：
上車：
目的：
姓名：
電話：
人數：
行李及尺吋：
⚠️備註：`;

  const quickReplyItems: messagingApi.QuickReplyItem[] = [
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '市區搭乘🚗',
        data: 'action=service_select&service=city_ride',
        displayText: '市區搭乘🚗',
        inputOption: 'openKeyboard',
        fillInText: cityRideFillIn,
      },
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '機場預約✈️',
        data: 'action=service_select&service=airport_ride',
        displayText: '機場預約✈️',
        inputOption: 'openKeyboard',
        fillInText: airportFillIn,
      },
    },
    {
      type: 'action',
      action: {
        type: 'message',
        label: '酒後代駕🍺',
        text: '酒後代駕🍺',
      },
    },
    {
      type: 'action',
      action: {
        type: 'message',
        label: '代購代送🛍️',
        text: '代購代送🛍️',
      },
    },
    {
      type: 'action',
      action: {
        type: 'message',
        label: '包車服務🚙',
        text: '包車服務🚙',
      },
    },
  ];

  return {
    type: 'text',
    text: welcomeText,
    quickReply: {
      items: quickReplyItems,
    },
  };
}

/**
 * 產生「市區搭乘」專屬引導訊息，附帶 Quick Reply（若需重新帶入範本）
 */
export function createCityRidePromptMessage(): messagingApi.TextMessage {
  const cityRideFillIn = `1. 上車地點：
2. 下車地點：
3. 人數：
4. 乘車時間：`;

  return {
    type: 'text',
    text: '您選擇了【市區搭乘🚗】服務 🚕，請直接輸入您的：1. 上車地點 2. 下車地點 3. 人數 4. 乘車時間（現在要車免填），派單專員將立即為您安排優質司機！',
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: '📝 帶入叫車格式',
            data: 'action=service_select&service=city_ride',
            displayText: '填寫叫車資訊',
            inputOption: 'openKeyboard',
            fillInText: cityRideFillIn,
          },
        },
      ],
    },
  };
}

/**
 * 產生「機場預約」專屬引導訊息，附帶 Quick Reply 與文字輸入框帶入表格
 */
export function createAirportRidePromptMessage(): messagingApi.TextMessage {
  const airportFillIn = `送機 /接機 ：
航班：（接機必填）（出國免填）
日期：
時間：
上車：
目的：
姓名：
電話：
人數：
行李及尺吋：
⚠️備註：`;

  const replyText = `🥇🌊福露機場表格🥇🌊
請詳細填寫以下表格✈️
送機 /接機 ：
航班：（接機必填）（出國免填）
日期：
時間：
上車：
目的：
姓名：
電話：
人數：
行李及尺吋：
⚠️備註：`;

  return {
    type: 'text',
    text: replyText,
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: '✈️ 帶入機場表格',
            data: 'action=service_select&service=airport_ride',
            displayText: '填寫機場預約',
            inputOption: 'openKeyboard',
            fillInText: airportFillIn,
          },
        },
      ],
    },
  };
}

/**
 * 組合派單複製文字（包含上車地點、下車地點、指定路線），方便分享文字到外群
 */
export function buildDispatchCopyText(params: {
  pickupAddress: string;
  dropoffAddress?: string | null;
  fixedRoute?: string | null;
}): string {
  const dropoffText =
    params.dropoffAddress && params.dropoffAddress.trim()
      ? params.dropoffAddress.trim()
      : '乘客上車後說明';
  const routeText =
    params.fixedRoute && params.fixedRoute.trim()
      ? params.fixedRoute.trim()
      : '依導航最佳路線';
  return `🟢 上車地點：${params.pickupAddress}\n🔴 下車地點：${dropoffText}\n🛣️ 指定路線：${routeText}`;
}

/**
 * 建立司機群組派單廣播卡片 (Tier 1: 僅顯示乘客人數、上車點、下車點，不揭露電話姓氏)
 */
export function createGroupDispatchOrderFlexMessage(params: {
  orderId: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  passengerCount?: number;
  scheduledTimeText?: string;
  isReservation?: boolean;
  estimatedFare?: number | null;
  fareBreakdown?: string;
  distanceKm?: number;
  fixedRoute?: string | null;
  bidUrl: string;
  shortTripUrl?: string;
}): messagingApi.FlexMessage {
  const isDropoffSpecified = Boolean(params.dropoffAddress && params.dropoffAddress.trim());
  const hasDetailedDropoff = isDetailedDropoffAddress(params.dropoffAddress);
  const fixedRouteText = params.fixedRoute?.trim() || '';
  const copyText = buildDispatchCopyText({
    pickupAddress: params.pickupAddress,
    dropoffAddress: params.dropoffAddress,
    fixedRoute: fixedRouteText || null,
  });

  const bodyContents: messagingApi.FlexComponent[] = [
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '🟢 上車地點：',
          color: '#64748b',
          size: 'sm',
          flex: 3,
        },
        {
          type: 'text',
          text: params.pickupAddress,
          color: '#0f172a',
          weight: 'bold',
          size: 'sm',
          wrap: true,
          flex: 7,
        },
      ],
    },
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '🔴 下車地點：',
          color: '#64748b',
          size: 'sm',
          flex: 3,
        },
        {
          type: 'text',
          text: isDropoffSpecified ? params.dropoffAddress! : '乘客上車後說明',
          color: isDropoffSpecified ? '#0f172a' : '#64748b',
          weight: isDropoffSpecified ? 'bold' : 'regular',
          size: 'sm',
          wrap: true,
          flex: 7,
        },
      ],
    },
    {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '👥 人數：',
          color: '#64748b',
          size: 'sm',
          flex: 3,
        },
        {
          type: 'text',
          text: `${params.passengerCount || 1} 人`,
          color: '#0284c7',
          weight: 'bold',
          size: 'sm',
          wrap: true,
          flex: 7,
        },
      ],
    },
  ];

  if (fixedRouteText) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '🛣️ 指定路線：',
          color: '#64748b',
          size: 'sm',
          flex: 3,
        },
        {
          type: 'text',
          text: fixedRouteText,
          color: '#7c3aed',
          weight: 'bold',
          size: 'sm',
          wrap: true,
          flex: 7,
        },
      ],
    });
  }

  if (params.scheduledTimeText) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '⏰ 乘車時間：',
          color: '#64748b',
          size: 'sm',
          flex: 3,
        },
        {
          type: 'text',
          text: params.scheduledTimeText,
          color: '#0284c7',
          weight: 'bold',
          size: 'sm',
          wrap: true,
          flex: 7,
        },
      ],
    });
  }

  // 需求: 當使用者沒有詳細下車地址時，接單不顯示金額 (只有在有填詳細下車地址或為常客固定金額且計算出有效預估車資時才顯示金額)
  if (
    (hasDetailedDropoff || Boolean(fixedRouteText) || Boolean(params.fareBreakdown?.includes('常客'))) &&
    params.estimatedFare !== undefined &&
    params.estimatedFare !== null &&
    Number(params.estimatedFare) > 0
  ) {
    const fareText = `$${params.estimatedFare}`;
    const detailText = params.fareBreakdown
      ? `（${params.fareBreakdown}）`
      : '';

    bodyContents.push(
      {
        type: 'separator',
        color: '#f1f5f9',
        margin: 'md',
      } as messagingApi.FlexSeparator,
      {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        margin: 'md',
        contents: [
          {
            type: 'text',
            text: '💰 預估車資：',
            color: '#b45309',
            size: 'sm',
            weight: 'bold',
            flex: 3,
          },
          {
            type: 'text',
            text: `${fareText}${detailText}`,
            color: '#b45309',
            weight: 'bold',
            size: 'sm',
            wrap: true,
            flex: 7,
          },
        ],
      }
    );
  }

  bodyContents.push(
    {
      type: 'separator',
      color: '#f1f5f9',
      margin: 'md',
    },
    {
      type: 'button',
      style: 'primary',
      color: params.isReservation ? '#059669' : '#06c755',
      height: 'md',
      action: {
        type: 'uri',
        label: params.isReservation ? '📅 立刻接單 (預約行程)' : '⚡ 立刻接單 (測算時間)',
        uri: params.bidUrl,
      },
    },
    {
      type: 'button',
      style: 'secondary',
      color: '#e2e8f0',
      height: 'md',
      margin: 'sm',
      action: {
        type: 'clipboard',
        label: '📋 複製派單資訊',
        clipboardText: copyText,
      },
    }
  );

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: params.isReservation ? '#064e3b' : '#1e293b', // 預約單改為墨綠色 #064e3b，即時單為深藍色 #1e293b
      paddingAll: '16px',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          justifyContent: 'space-between',
          alignItems: 'center',
          contents: [
            {
              type: 'text',
              text: params.isReservation ? '📅 預約單' : '⚡ 新派單廣播 (市區搭乘)',
              color: params.isReservation ? '#6ee7b7' : '#38bdf8',
              weight: 'bold',
              size: 'sm',
            },
            {
              type: 'text',
              text: '30秒搶單中',
              color: '#facc15',
              size: 'xs',
              weight: 'bold',
            },
          ],
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '18px',
      spacing: 'md',
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f8fafc',
      paddingAll: '10px',
      contents: [
        {
          type: 'text',
          text: '點擊開啟定位並計算到達時間，系統將自動比對最近司機中單',
          color: '#94a3b8',
          size: 'xxs',
          align: 'center',
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: params.isReservation
      ? `📅 預約單：${params.pickupAddress}`
      : `⚡ 新派單需求：${params.pickupAddress}`,
    contents: container,
  };
}

/**
 * 建立指派成功卡片 (比照附圖的深灰底 MG&MD 優質司機卡片樣式)
 * 包含：駕駛、車型、車號、車色、禁菸禁食、預計到達分鐘數
 */
export function createDriverAssignedFlexMessage(params: {
  driverName: string;
  carBrand: string;
  plateNumber: string;
  carColor: string;
  etaMinutes: number;
  notes?: string | null;
}): messagingApi.FlexMessage {
  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    styles: {
      body: {
        backgroundColor: '#ffffff',
      },
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '20px',
      spacing: 'md',
      contents: [
        {
          type: 'text',
          text: 'MG&MD 優質司機',
          color: '#1e293b',
          size: 'lg',
          weight: 'bold',
        },
        {
          type: 'separator',
          color: '#e2e8f0',
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          margin: 'md',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '駕駛：', color: '#64748b', size: 'md', flex: 3 },
                { type: 'text', text: params.driverName, color: '#0f172a', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '車型：', color: '#64748b', size: 'md', flex: 3 },
                { type: 'text', text: params.carBrand, color: '#0f172a', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '車號：', color: '#64748b', size: 'md', flex: 3 },
                { type: 'text', text: params.plateNumber, color: '#0f172a', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '車色：', color: '#64748b', size: 'md', flex: 3 },
                { type: 'text', text: params.carColor, color: '#0f172a', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '預計到達：', color: '#d97706', size: 'md', weight: 'bold', flex: 3 },
                { type: 'text', text: `約 ${params.etaMinutes} 分鐘內抵達`, color: '#d97706', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
          ],
        },
        {
          type: 'separator',
          color: '#e2e8f0',
          margin: 'md',
        },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            {
              type: 'text',
              text: params.notes?.trim() ? params.notes : '🚭 禁菸 🚯 禁食',
              color: '#475569',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
          ],
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `🚕 已指派司機：${params.driverName}（約 ${params.etaMinutes} 分鐘抵達）`,
    contents: container,
  };
}

/**
 * 司機群組派單中單提示卡片（僅提示是誰接到單，下方 ghost button 開啟 1:1 OA）
 */
export function createGroupOrderWonFlexMessage(params: {
  driverName: string;
  oaUrl?: string;
  orderId?: string;
  winnerDriverId?: string;
  checkUrl?: string;
  isReservation?: boolean;
}): messagingApi.FlexMessage {
  const oaUrl = params.oaUrl || env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw';
  const defaultCheckUrl = params.orderId
    ? (env.LIFF_ID
        ? `https://liff.line.me/${env.LIFF_ID}/driver/bid?orderId=${params.orderId}&mode=check_won`
        : `https://flow-taxi-production.up.railway.app/driver/bid?orderId=${params.orderId}&mode=check_won`)
    : undefined;
  const buttonUri = params.checkUrl || defaultCheckUrl || oaUrl;
  const showReservationAck = Boolean(params.isReservation && params.orderId);

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0f172a',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '🚕【派單已結單】',
          color: '#38bdf8',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `恭喜 @${params.driverName} 成功接單！`,
          color: '#facc15',
          weight: 'bold',
          size: 'sm',
          margin: 'sm',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '16px',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: showReservationAck
            ? '請接單司機於 1 小時內點擊下方「我知道了」確認承接預約單（逾時未按管理員可重啟改派）。確認後系統將於預約單前 1 小時於 1:1 OA 發送出車通知。'
            : '詳細接單任務資訊已同步至接單司機 1:1 官方帳號。後續回報（到點、客上、乘客下車結單）請點擊下方開啟 1:1 OA 進行。',
          color: '#64748b',
          size: 'xs',
          wrap: true,
          lineSpacing: '3px',
        },
        {
          type: 'separator',
          color: '#f1f5f9',
          margin: 'md',
        },
        ...(showReservationAck
          ? ([
              {
                type: 'button',
                style: 'primary',
                height: 'sm',
                color: '#16a34a',
                action: {
                  type: 'postback',
                  label: '✅ 我知道了',
                  data: `action=ack_reservation&orderId=${params.orderId}`,
                  displayText: '我知道了',
                },
              },
            ] as messagingApi.FlexComponent[])
          : []),
        {
          type: 'button',
          style: 'link', // Ghost Button 樣式（無邊框底色）
          height: 'sm',
          color: '#0284c7',
          action: {
            type: 'uri',
            label: '💬 開啟 1:1 OA 查看訂單與回報',
            uri: buttonUri,
          },
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `🚕【派單已結單】恭喜 @${params.driverName} 成功接單！`,
    contents: container,
  };
}

/**
 * 司機 1:1 OA 確認接單卡片（呈現於司機與 OA 的 1:1 聊天室，附導航與回報到達按鈕）
 */
export function createDriverOrderCardFlexMessage(params: {
  driverName: string;
  orderId: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  passengerCount: number;
  etaMinutes: number;
  scheduledTimeText?: string;
}): messagingApi.FlexMessage {
  // 1. 前往上車地點：起點不填（Google Maps 會自動抓取司機目前手機定位），終點為乘客上車點（加上 openExternalBrowser=1 避免 LINE 內嵌瀏覽器無法定位）
  const pickupMapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(params.pickupAddress)}&travelmode=driving&openExternalBrowser=1`;
  // 2. 開啟下車地點定位：起點為乘客上車點，終點為乘客下車目的地（加上 openExternalBrowser=1）
  const dropoffMapUrl = params.dropoffAddress
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(params.pickupAddress)}&destination=${encodeURIComponent(params.dropoffAddress)}&travelmode=driving&openExternalBrowser=1`
    : null;

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0f172a',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '🚕【確認接單任務明細】',
          color: '#38bdf8',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `恭喜 @${params.driverName} 成功接單！`,
          color: '#facc15',
          weight: 'bold',
          size: 'sm',
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
            { type: 'text', text: '🟢 上車地點：', color: '#64748b', size: 'sm', flex: 3 },
            { type: 'text', text: params.pickupAddress, color: '#0f172a', size: 'sm', weight: 'bold', flex: 7, wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '🔴 下車目的地：', color: '#64748b', size: 'sm', flex: 3 },
            { type: 'text', text: params.dropoffAddress || '乘客上車後說明', color: '#0f172a', size: 'sm', weight: 'bold', flex: 7, wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '👥 乘車人數：', color: '#64748b', size: 'sm', flex: 3 },
            { type: 'text', text: `${params.passengerCount} 人`, color: '#0284c7', size: 'sm', weight: 'bold', flex: 7 },
          ],
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '⏱️ 約定到達：', color: '#64748b', size: 'sm', flex: 3 },
            { type: 'text', text: `約 ${params.etaMinutes} 分鐘內抵達`, color: '#16a34a', size: 'sm', weight: 'bold', flex: 7 },
          ],
        },
        ...(params.scheduledTimeText ? [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '⏰ 預約時間：', color: '#64748b', size: 'sm', flex: 3 },
              { type: 'text', text: params.scheduledTimeText, color: '#0284c7', size: 'sm', weight: 'bold', flex: 7 },
            ],
          } as messagingApi.FlexComponent,
        ] : []),
        {
          type: 'separator',
          color: '#f1f5f9',
          margin: 'md',
        },
        {
          type: 'button',
          style: 'primary',
          color: '#2563eb',
          height: 'md',
          action: {
            type: 'uri',
            label: '📍 前往上車地點',
            uri: pickupMapUrl,
          },
        },
        ...(dropoffMapUrl ? [
          {
            type: 'button',
            style: 'secondary',
            color: '#f8fafc',
            height: 'md',
            margin: 'sm',
            action: {
              type: 'uri',
              label: '📍 開啟下車地點定位',
              uri: dropoffMapUrl,
            },
          } as messagingApi.FlexComponent,
        ] : []),
        {
          type: 'button',
          style: 'secondary',
          color: '#f8fafc',
          height: 'md',
          margin: 'sm',
          action: {
            type: 'message',
            label: '🔔 我已到達上車點 (通知乘客)',
            text: '到',
          },
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f8fafc',
      paddingAll: '10px',
      contents: [
        {
          type: 'text',
          text: '抵達請點擊「我已到達」，客上請回報「客上」，乘客下車請回報「乘客下車」進行結單。祝行車平安！',
          color: '#94a3b8',
          size: 'xxs',
          align: 'center',
          wrap: true,
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `🚕【確認接單任務】恭喜 @${params.driverName} 成功接單！`,
    contents: container,
  };
}

/**
 * 建立「群組/聊天室訂單已取消」的通知 Flex Message 卡片
 * 當乘客在媒合中或接單後取消時，推播至司機群組通知司機
 */
export function createGroupOrderCancelledFlexMessage(params: {
  orderId: string;
  pickupAddress: string;
  dropoffAddress?: string;
  reason?: string;
}): messagingApi.FlexMessage {
  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1e293b',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '❌【訂單已取消】',
          color: '#f87171',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `訂單編號 #${params.orderId.slice(-4)}`,
          color: '#cbd5e1',
          weight: 'bold',
          size: 'xs',
          margin: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '16px',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: `🟢 上車：${params.pickupAddress}`,
              color: '#334155',
              size: 'xs',
              weight: 'bold',
              wrap: true,
            },
            ...(params.dropoffAddress ? [
              {
                type: 'text' as const,
                text: `🔴 下車：${params.dropoffAddress}`,
                color: '#64748b',
                size: 'xs',
                wrap: true,
              }
            ] : []),
          ],
        },
        {
          type: 'separator',
          color: '#f1f5f9',
          margin: 'md',
        },
        {
          type: 'text',
          text: params.reason || '⚠️ 乘客已取消此筆叫車，請各位司機夥伴無須搶單。感謝配合！',
          color: '#ef4444',
          size: 'xs',
          wrap: true,
          lineSpacing: '3px',
          margin: 'sm',
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `❌【訂單已取消】訂單 #${params.orderId.slice(-4)} 乘客已取消叫車`,
    contents: container,
  };
}

/**
 * 相容既有別名
 */
export const createGroupOrderAssignedFlexMessage = createDriverOrderCardFlexMessage;

/**
 * 建立「乘客 1:1 OA 預約叫車確認」Flex Message 卡片
 */
export function createPassengerReservationConfirmedFlexMessage(params: {
  orderId: string;
  scheduledTimeText: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  driverName: string;
  carBrand: string;
  plateNumber: string;
  carColor?: string;
  estimatedFare?: number | null;
}): messagingApi.FlexMessage {
  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0f172a',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '🎉【預約叫車已確認】',
          color: '#38bdf8',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `訂單編號 #${params.orderId.slice(-4)}`,
          color: '#94a3b8',
          size: 'xs',
          margin: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#f0fdf4',
          borderColor: '#bbf7d0',
          borderWidth: '1px',
          cornerRadius: '12px',
          paddingAll: '12px',
          contents: [
            {
              type: 'text',
              text: '📅 預約搭乘時間',
              color: '#166534',
              size: 'xs',
              weight: 'bold',
            },
            {
              type: 'text',
              text: params.scheduledTimeText,
              color: '#15803d',
              size: 'lg',
              weight: 'bold',
              margin: 'xs',
            },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: `🟢 上車：${params.pickupAddress}`,
              color: '#334155',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
            ...(params.dropoffAddress ? [
              {
                type: 'text' as const,
                text: `🔴 下車：${params.dropoffAddress}`,
                color: '#64748b',
                size: 'sm',
                wrap: true,
              }
            ] : []),
          ],
        },
        {
          type: 'separator',
          color: '#f1f5f9',
        },
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          contents: [
            {
              type: 'text',
              text: '👤 司機夥伴',
              color: '#64748b',
              size: 'xs',
              flex: 3,
            },
            {
              type: 'text',
              text: `${params.driverName}（${params.carBrand} ${params.plateNumber}）`,
              color: '#0f172a',
              weight: 'bold',
              size: 'xs',
              wrap: true,
              flex: 7,
            },
          ],
        },
        {
          type: 'separator',
          color: '#f1f5f9',
        },
        {
          type: 'text',
          text: '⏰ 請於約定時間準時搭車。系統將在【用車前 1 小時】再次發送提醒通知！如需傳達訊息給司機，可隨時輸入「與司機溝通」。✨',
          color: '#0284c7',
          size: 'xs',
          wrap: true,
          lineSpacing: '4px',
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `🎉【預約行程已確認】乘車時間：${params.scheduledTimeText}`,
    contents: container,
  };
}

/**
 * 建立「司機 1:1 OA 預約單任務通知」Flex Message 卡片
 */
export function createDriverReservationOrderCardFlexMessage(params: {
  orderId: string;
  driverName: string;
  scheduledTimeText: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  passengerCount?: number;
  estimatedFare?: number | null;
}): messagingApi.FlexMessage {
  const pickupMapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(params.pickupAddress)}&travelmode=driving&openExternalBrowser=1`;

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1e293b',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '📅【預約單已成立】',
          color: '#38bdf8',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `恭喜 @${params.driverName} 成功承接預約行程！`,
          color: '#94a3b8',
          size: 'xs',
          margin: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#eff6ff',
          borderColor: '#bfdbfe',
          borderWidth: '1px',
          cornerRadius: '12px',
          paddingAll: '12px',
          contents: [
            {
              type: 'text',
              text: '⏰ 預約用車時間',
              color: '#1d4ed8',
              size: 'xs',
              weight: 'bold',
            },
            {
              type: 'text',
              text: params.scheduledTimeText,
              color: '#1e40af',
              size: 'lg',
              weight: 'bold',
              margin: 'xs',
            },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: `🟢 上車：${params.pickupAddress}`,
              color: '#334155',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
            ...(params.dropoffAddress ? [
              {
                type: 'text' as const,
                text: `🔴 下車：${params.dropoffAddress}`,
                color: '#64748b',
                size: 'sm',
                wrap: true,
              }
            ] : []),
          ],
        },
        {
          type: 'separator',
          color: '#f1f5f9',
        },
        {
          type: 'text',
          text: '📢 提醒您：此單為預約行程，請於 1 小時內點擊下方「我知道了」確認接單（若 1 小時內未按，管理員可重啟此單改派其他司機）。確認後系統將在【出發前 1 小時】發送出車提醒通知，引導您前往上車地點載客！🚕',
          color: '#d97706',
          size: 'xs',
          wrap: true,
          lineSpacing: '4px',
        },
        {
          type: 'button',
          style: 'primary',
          color: '#16a34a',
          height: 'md',
          action: {
            type: 'postback',
            label: '✅ 我知道了',
            data: `action=ack_reservation&orderId=${params.orderId}`,
            displayText: '我知道了',
          },
        },
        {
          type: 'button',
          style: 'secondary',
          color: '#f8fafc',
          height: 'sm',
          action: {
            type: 'uri',
            label: '🗺️ 預先查看路線',
            uri: pickupMapUrl,
          },
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f8fafc',
      paddingAll: '10px',
      contents: [
        {
          type: 'text',
          text: '已同步記錄至您的接單程式「預約行程」清單，可隨時查看。',
          color: '#94a3b8',
          size: 'xxs',
          align: 'center',
          wrap: true,
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `📅【預約單已成立】乘車時間：${params.scheduledTimeText}`,
    contents: container,
  };
}

export interface CustomerReservationStatusItem {
  orderId: string;
  scheduledTimeText: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  passengerCount?: number;
  estimatedFare?: number | null;
  status: string;
  isAccepted: boolean;
  driverAcknowledged?: boolean;
  driverName?: string | null;
  carBrand?: string | null;
  plateNumber?: string | null;
  carColor?: string | null;
}

/**
 * 乘客於 1:1 OA 輸入「我的預約」時，呈現正在進行的預約單與是否接單狀態之 Flex Message
 */
export function createCustomerReservationStatusFlexMessage(
  items: CustomerReservationStatusItem[]
): messagingApi.FlexMessage {
  const buildBubble = (item: CustomerReservationStatusItem): messagingApi.FlexBubble => {
    const shortId = item.orderId.slice(-4);
    const statusBadgeText = item.isAccepted ? '✅ 已接單' : '⏳ 尚未接單';
    const statusBadgeBg = item.isAccepted ? '#16a34a' : '#d97706';

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#0f172a',
        paddingAll: '16px',
        alignItems: 'center',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            contents: [
              {
                type: 'text',
                text: '📅【我的預約單】',
                color: '#38bdf8',
                weight: 'bold',
                size: 'md',
              },
              {
                type: 'text',
                text: `訂單編號 #${shortId}`,
                color: '#94a3b8',
                size: 'xs',
                margin: 'xs',
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: statusBadgeBg,
            cornerRadius: '8px',
            paddingAll: '6px',
            paddingStart: '10px',
            paddingEnd: '10px',
            contents: [
              {
                type: 'text',
                text: statusBadgeText,
                color: '#ffffff',
                size: 'xs',
                weight: 'bold',
                align: 'center',
              },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#ffffff',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: item.isAccepted ? '#f0fdf4' : '#fffbeb',
            borderColor: item.isAccepted ? '#bbf7d0' : '#fde68a',
            borderWidth: '1px',
            cornerRadius: '12px',
            paddingAll: '12px',
            contents: [
              {
                type: 'text',
                text: '📅 預約搭乘時間',
                color: item.isAccepted ? '#166534' : '#92400e',
                size: 'xs',
                weight: 'bold',
              },
              {
                type: 'text',
                text: item.scheduledTimeText || '預約行程',
                color: item.isAccepted ? '#15803d' : '#b45309',
                size: 'lg',
                weight: 'bold',
                margin: 'xs',
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              {
                type: 'text',
                text: `🟢 上車：${item.pickupAddress}`,
                color: '#334155',
                size: 'sm',
                weight: 'bold',
                wrap: true,
              },
              {
                type: 'text',
                text: `🔴 下車：${item.dropoffAddress || '上車後告知'}`,
                color: '#64748b',
                size: 'sm',
                wrap: true,
              },
              ...(item.estimatedFare
                ? ([
                    {
                      type: 'text',
                      text: `💰 預估車資：$${item.estimatedFare}`,
                      color: '#0f172a',
                      size: 'sm',
                      weight: 'bold',
                    },
                  ] as messagingApi.FlexComponent[])
                : []),
            ],
          },
          {
            type: 'separator',
            color: '#f1f5f9',
          },
          ...(item.isAccepted
            ? ([
                {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'xs',
                  contents: [
                    {
                      type: 'text',
                      text: item.driverAcknowledged
                        ? '📋 接單狀態：✅ 司機已接單並確認行程'
                        : '📋 接單狀態：✅ 已指派司機承接',
                      color: '#16a34a',
                      size: 'xs',
                      weight: 'bold',
                      wrap: true,
                    },
                    {
                      type: 'text',
                      text: `👤 接單司機：${item.driverName || '優質司機'}（${item.carBrand || 'TOYOTA'} ${item.plateNumber || '---'} / ${item.carColor || '黑色'}）`,
                      color: '#0f172a',
                      size: 'xs',
                      weight: 'bold',
                      wrap: true,
                    },
                  ],
                },
              ] as messagingApi.FlexComponent[])
            : ([
                {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'xs',
                  contents: [
                    {
                      type: 'text',
                      text: '📋 接單狀態：⏳ 尚未有司機接單（派單媒合中）',
                      color: '#d97706',
                      size: 'xs',
                      weight: 'bold',
                      wrap: true,
                    },
                    {
                      type: 'text',
                      text: '系統將於上車前 10 小時起每半小時自動為您呼叫司機；若出發前 1 小時仍無司機接單，系統將主動通知您。',
                      color: '#64748b',
                      size: 'xxs',
                      wrap: true,
                      lineSpacing: '3px',
                    },
                  ],
                },
              ] as messagingApi.FlexComponent[])),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#f8fafc',
        paddingAll: '12px',
        spacing: 'sm',
        contents: [
          ...(item.isAccepted
            ? ([
                {
                  type: 'button',
                  style: 'primary',
                  color: '#0284c7',
                  height: 'sm',
                  action: {
                    type: 'message',
                    label: `💬 與司機溝通 #${shortId}`,
                    text: `與司機溝通 #${shortId}`,
                  },
                },
              ] as messagingApi.FlexComponent[])
            : []),
          {
            type: 'button',
            style: 'secondary',
            color: '#f1f5f9',
            height: 'sm',
            action: {
              type: 'message',
              label: `❌ 取消預約 #${shortId}`,
              text: `取消訂單 #${shortId}`,
            },
          },
        ],
      },
    };
  };

  if (items.length === 1) {
    const first = items[0];
    return {
      type: 'flex',
      altText: `📅【我的預約單】#${first.orderId.slice(-4)}（${first.isAccepted ? '已接單' : '尚未接單'}）`,
      contents: buildBubble(first),
    };
  }

  return {
    type: 'flex',
    altText: `📅【我的預約單】共 ${items.length} 筆進行中的預約行程`,
    contents: {
      type: 'carousel',
      contents: items.slice(0, 10).map(buildBubble),
    },
  };
}

/**
 * 司機接預約單後 1 小時內未按「我知道了」時，推播至管理員群組的重啟派單提醒卡片
 */
export function createAdminUnacknowledgedReservationFlexMessage(params: {
  orderId: string;
  driverName: string;
  scheduledTimeText: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
}): messagingApi.FlexMessage {
  const shortId = params.orderId.slice(-4);

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#991b1b',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '⚠️【預約單逾 1 小時未確認】',
          color: '#fef08a',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `訂單 #${shortId}｜司機 @${params.driverName}`,
          color: '#fecaca',
          size: 'xs',
          margin: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '16px',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: `⏰ 預約時間：${params.scheduledTimeText}`,
          color: '#0f172a',
          size: 'xs',
          weight: 'bold',
          wrap: true,
        },
        {
          type: 'text',
          text: `🟢 上車：${params.pickupAddress}`,
          color: '#334155',
          size: 'xs',
          wrap: true,
        },
        ...(params.dropoffAddress
          ? ([
              {
                type: 'text',
                text: `🔴 下車：${params.dropoffAddress}`,
                color: '#64748b',
                size: 'xs',
                wrap: true,
              },
            ] as messagingApi.FlexComponent[])
          : []),
        {
          type: 'separator',
          color: '#f1f5f9',
          margin: 'md',
        },
        {
          type: 'text',
          text: '該名司機承接預約單後已超過 1 小時未點擊「我知道了」。管理員可點擊下方按鈕重啟此張預約單，重新尋找其他司機處理。',
          color: '#b91c1c',
          size: 'xs',
          wrap: true,
          lineSpacing: '3px',
        },
        {
          type: 'button',
          style: 'primary',
          color: '#dc2626',
          height: 'sm',
          margin: 'md',
          action: {
            type: 'postback',
            label: `🔄 重啟預約單 #${shortId} 找其他司機`,
            data: `action=admin_reopen_reservation&orderId=${params.orderId}`,
            displayText: `重啟預約單 #${shortId}`,
          },
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `⚠️【預約單未確認】訂單 #${shortId} 司機逾 1 小時未按「我知道了」，管理員可重啟派單`,
    contents: container,
  };
}

/**
 * 司機按下「客上」後，於 1:1 OA 顯示的訂單與金額確認卡片
 * - 若使用者有詳細下車地址且已算出金額：顯示訂單金額，下方提供「確認金額並回報」與「調整訂單金額並回報」兩個按鈕
 * - 若使用者沒有詳細下車地址（無預估金額）：不預先顯示金額，提示司機於回報下車時必填金額，並開啟網頁填寫金額（必填）回報結單
 */
export function createDriverBoardedFareConfirmFlexMessage(params: {
  orderId: string;
  driverName?: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  passengerCount?: number;
  fare?: number | null;
  adjustFareUrl?: string;
}): messagingApi.FlexMessage {
  const shortId = params.orderId.slice(-4);
  const adjustFareUrl =
    params.adjustFareUrl ||
    (env.LIFF_ID
      ? `https://liff.line.me/${env.LIFF_ID}/driver/adjust-fare?orderId=${params.orderId}`
      : `https://flow-taxi-production.up.railway.app/driver/adjust-fare?orderId=${params.orderId}`);

  const hasPrecalculatedFare = Boolean(
    isDetailedDropoffAddress(params.dropoffAddress) &&
      params.fare !== null &&
      params.fare !== undefined &&
      Number(params.fare) > 0
  );

  const fareBannerBox: messagingApi.FlexBox = hasPrecalculatedFare
    ? {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#f0fdf4',
        borderColor: '#bbf7d0',
        borderWidth: '1px',
        cornerRadius: '12px',
        paddingAll: '12px',
        contents: [
          {
            type: 'text',
            text: '💵 本單車資金額',
            color: '#166534',
            size: 'xs',
            weight: 'bold',
            align: 'center',
          },
          {
            type: 'text',
            text: `$${params.fare}`,
            color: '#15803d',
            size: 'xxl',
            weight: 'bold',
            align: 'center',
            margin: 'xs',
          },
        ],
      }
    : {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#fffbeb',
        borderColor: '#fde68a',
        borderWidth: '1px',
        cornerRadius: '12px',
        paddingAll: '12px',
        contents: [
          {
            type: 'text',
            text: '⚠️ 未提供詳細下車地址（下車時金額必填）',
            color: '#b45309',
            size: 'xs',
            weight: 'bold',
            align: 'center',
            wrap: true,
          },
          {
            type: 'text',
            text: '請於乘客下車時點擊下方按鈕填寫實際車資金額（必填）並回報結單',
            color: '#92400e',
            size: 'xxs',
            align: 'center',
            margin: 'xs',
            wrap: true,
          },
        ],
      };

  const actionButtons: messagingApi.FlexComponent[] = hasPrecalculatedFare
    ? [
        {
          type: 'text',
          text: '抵達目的地後，若金額無誤請點選「確認金額並回報」直接結單；若需修改金額或填寫備註，請點選「調整訂單金額並回報」。',
          color: '#64748b',
          size: 'xs',
          wrap: true,
          lineSpacing: '3px',
        },
        {
          type: 'button',
          style: 'primary',
          color: '#16a34a',
          height: 'md',
          action: {
            type: 'postback',
            label: '確認金額並回報',
            data: `action=confirm_fare_complete&orderId=${params.orderId}&fare=${params.fare}`,
            displayText: '確認金額並回報',
          },
        },
        {
          type: 'button',
          style: 'secondary',
          color: '#f1f5f9',
          height: 'md',
          action: {
            type: 'uri',
            label: '調整訂單金額並回報',
            uri: adjustFareUrl,
          },
        },
      ]
    : [
        {
          type: 'text',
          text: '由於乘客未提供詳細下車地址，抵達目的地回報下車時，「訂單金額」欄位為必填，請點選下方按鈕填寫金額並回報結單：',
          color: '#64748b',
          size: 'xs',
          wrap: true,
          lineSpacing: '3px',
        },
        {
          type: 'button',
          style: 'primary',
          color: '#16a34a',
          height: 'md',
          action: {
            type: 'uri',
            label: '填寫訂單金額並回報',
            uri: adjustFareUrl,
          },
        },
      ];

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0f172a',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '🚕【客上行程中・結單金額回報】',
          color: '#38bdf8',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `訂單編號 #${shortId}`,
          color: '#94a3b8',
          size: 'xs',
          margin: 'xs',
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
        fareBannerBox,
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: `🟢 上車：${params.pickupAddress}`,
              color: '#334155',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: `🔴 下車：${params.dropoffAddress || '乘客上車後說明'}`,
              color: '#64748b',
              size: 'sm',
              wrap: true,
            },
            {
              type: 'text',
              text: `👥 人數：${params.passengerCount || 1} 人`,
              color: '#64748b',
              size: 'xs',
            },
          ],
        },
        {
          type: 'separator',
          color: '#f1f5f9',
        },
        ...actionButtons,
      ],
    },
  };

  return {
    type: 'flex',
    altText: hasPrecalculatedFare
      ? `🚕【客上行程中】訂單 #${shortId} 本單金額：$${params.fare}（請於下車時確認或調整金額回報結單）`
      : `🚕【客上行程中】訂單 #${shortId}（無詳細下車地址，請於下車時必填金額回報結單）`,
    contents: container,
  };
}

/**
 * 司機點擊「確認金額並回報」或於網頁送出「調整訂單金額並回報」後，
 * 推播至司機群組 (chatroom) 的訂單已完結卡片（顯示完結狀態與金額）
 */
export function createGroupOrderCompletedFlexMessage(params: {
  orderId: string;
  driverName?: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  fare: number;
  isAdjusted?: boolean;
  adjustNote?: string | null;
}): messagingApi.FlexMessage {
  const shortId = params.orderId.slice(-4);
  const driverLabel = params.driverName ? `@${params.driverName}` : '接單司機';

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0f172a',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '🏁【這筆訂單已完結】',
          color: '#4ade80',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `訂單編號 #${shortId}｜${driverLabel}`,
          color: '#94a3b8',
          size: 'xs',
          margin: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#f0fdf4',
          borderColor: '#bbf7d0',
          borderWidth: '1px',
          cornerRadius: '10px',
          paddingAll: '12px',
          contents: [
            {
              type: 'text',
              text: params.isAdjusted ? '💰 結單金額（已調整）' : '💰 結單金額',
              color: '#166534',
              size: 'xs',
              weight: 'bold',
              align: 'center',
            },
            {
              type: 'text',
              text: `$${params.fare}`,
              color: '#15803d',
              size: 'xl',
              weight: 'bold',
              align: 'center',
              margin: 'xs',
            },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: `🟢 上車：${params.pickupAddress}`,
              color: '#334155',
              size: 'xs',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: `🔴 下車：${params.dropoffAddress || '乘客指定地點'}`,
              color: '#64748b',
              size: 'xs',
              wrap: true,
            },
            ...(params.adjustNote && params.adjustNote.trim()
              ? ([
                  {
                    type: 'text',
                    text: `📝 備註：${params.adjustNote.trim()}`,
                    color: '#0284c7',
                    size: 'xs',
                    weight: 'bold',
                    wrap: true,
                  },
                ] as messagingApi.FlexComponent[])
              : []),
          ],
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `🏁【這筆訂單已完結】訂單 #${shortId} 已完結，結單金額：$${params.fare}${params.adjustNote ? `（備註：${params.adjustNote}）` : ''}`,
    contents: container,
  };
}

/**
 * 司機送出回報後，若系統計算上車地點與下車地點距離小於 5 公里（短程單），
 * 推播 Flex Message 提示司機這趟系統計算是短程單，管理員核實之後會給他補單點數
 */
export function createDriverShortTripPendingFlexMessage(params: {
  orderId: string;
  pickupAddress: string;
  dropoffAddress: string;
  distanceKm: number;
  fare?: number | null;
}): messagingApi.FlexMessage {
  const shortId = params.orderId.slice(-4);
  const kmText = Number(params.distanceKm).toFixed(1);

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1e3a8a',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '📏【系統計算為短程單】',
          color: '#93c5fd',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `訂單編號 #${shortId}｜測算里程 ${kmText} 公里`,
          color: '#e0f2fe',
          size: 'xs',
          margin: 'xs',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ffffff',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            {
              type: 'text',
              text: `🟢 上車地點：${params.pickupAddress}`,
              color: '#0f172a',
              size: 'xs',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: `🔴 下車地點：${params.dropoffAddress}`,
              color: '#0f172a',
              size: 'xs',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: `📏 系統測算距離：${kmText} 公里（小於 5 公里）`,
              color: '#1d4ed8',
              size: 'xs',
              weight: 'bold',
              wrap: true,
            },
            ...(params.fare
              ? ([
                  {
                    type: 'text',
                    text: `💰 回報車資：$${params.fare}`,
                    color: '#475569',
                    size: 'xs',
                  },
                ] as messagingApi.FlexComponent[])
              : []),
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#fffbeb',
          borderColor: '#fde68a',
          borderWidth: '1px',
          cornerRadius: '10px',
          paddingAll: '12px',
          contents: [
            {
              type: 'text',
              text: '🎁 系統計算本趟行程小於 5 公里，屬於【短程單】！已自動送交管理群組請管理員核實，待管理員核實之後將會發給您 +1 點【補單點數】！',
              color: '#92400e',
              size: 'xs',
              weight: 'bold',
              wrap: true,
              lineSpacing: '4px',
            },
          ],
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `📏【短程單提示】訂單 #${shortId} 系統計算為短程單（${kmText}km），管理員核實之後會給您補單點數！`,
    contents: container,
  };
}

/**
 * 當有短單時，Chatbot 發送 Flex Message 到管理群組請管理員核實（核實通過後自動發放補單點數給司機）
 */
export function createAdminShortTripVerifyFlexMessage(params: {
  orderId: string;
  driverId: string;
  driverName?: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  distanceKm: number;
  fare?: number | null;
  adjustNote?: string | null;
}): messagingApi.FlexMessage {
  const shortId = params.orderId.slice(-4);
  const kmText = Number(params.distanceKm).toFixed(1);
  const driverLabel = params.driverName || '司機夥伴';

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#7c2d12',
      paddingAll: '16px',
      contents: [
        {
          type: 'text',
          text: '🕵️【短程單待管理員核實】',
          color: '#fdba74',
          weight: 'bold',
          size: 'md',
        },
        {
          type: 'text',
          text: `訂單編號 #${shortId}｜司機：${driverLabel}`,
          color: '#ffedd5',
          size: 'xs',
          margin: 'xs',
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
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: `🚖 接單司機：${driverLabel}`,
              color: '#0f172a',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: `🟢 上車地點：${params.pickupAddress}`,
              color: '#0f172a',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: `🔴 下車地點：${params.dropoffAddress}`,
              color: '#0f172a',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: `📏 系統測算距離：${kmText} 公里（小於 5 公里短程單）`,
              color: '#ea580c',
              size: 'sm',
              weight: 'bold',
              wrap: true,
            },
            ...(params.fare
              ? ([
                  {
                    type: 'text',
                    text: `💰 回報結單金額：$${params.fare}`,
                    color: '#334155',
                    size: 'sm',
                    weight: 'bold',
                  },
                ] as messagingApi.FlexComponent[])
              : []),
            ...(params.adjustNote && params.adjustNote.trim()
              ? ([
                  {
                    type: 'text',
                    text: `📝 司機備註：${params.adjustNote.trim()}`,
                    color: '#0284c7',
                    size: 'xs',
                    wrap: true,
                  },
                ] as messagingApi.FlexComponent[])
              : []),
          ],
        },
        {
          type: 'separator',
          color: '#f1f5f9',
        },
        {
          type: 'text',
          text: '請管理員核實此筆短程單上下車地點是否屬實。點擊「核實通過」將自動為司機發放 +1 點補單點數：',
          color: '#475569',
          size: 'xs',
          wrap: true,
        },
        {
          type: 'button',
          style: 'primary',
          color: '#059669',
          height: 'md',
          action: {
            type: 'postback',
            label: '✅ 核實通過（給司機補單點數）',
            data: `action=admin_verify_short_trip&orderId=${encodeURIComponent(params.orderId)}&driverId=${encodeURIComponent(params.driverId)}&approved=1`,
            displayText: `核實通過短程單 #${shortId}`,
          },
        },
        {
          type: 'button',
          style: 'secondary',
          color: '#e2e8f0',
          height: 'md',
          margin: 'sm',
          action: {
            type: 'postback',
            label: '❌ 駁回（不發放點數）',
            data: `action=admin_verify_short_trip&orderId=${encodeURIComponent(params.orderId)}&driverId=${encodeURIComponent(params.driverId)}&approved=0`,
            displayText: `駁回短程單 #${shortId}`,
          },
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `🕵️【短程單待管理員核實】訂單 #${shortId}（司機：${driverLabel}，距離 ${kmText}km），請管理員核實並發放補單點數`,
    contents: container,
  };
}



