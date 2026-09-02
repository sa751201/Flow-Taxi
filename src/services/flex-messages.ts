import { messagingApi } from '@line/bot-sdk';

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
收費方式如下
基本1️⃣0️⃣公里內7️⃣0️⃣0️⃣
超過公里數以1️⃣公里5️⃣0️⃣元計費

🔎以上費率僅限
北北基、桃園其他縣市另計。

請點選以下的符合您需求的服務，歡迎大家提早預約💎`;

  const cityRideFillIn = `1. 上車地點：
2. 下車地點：台北車站東門
3. 人數：
4. 乘車時間：現在要車免填🌊`;

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
    {
      type: 'action',
      action: {
        type: 'message',
        label: '搬運服務🧳',
        text: '搬運服務🧳',
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
2. 下車地點：台北車站東門
3. 人數：
4. 乘車時間：現在要車免填🌊`;

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
 * 建立司機群組派單廣播卡片 (Tier 1: 僅顯示乘客人數、上車點、下車點，不揭露電話姓氏)
 */
export function createGroupDispatchOrderFlexMessage(params: {
  orderId: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  passengerCount?: number;
  scheduledTimeText?: string;
  estimatedFare?: number | null;
  fareBreakdown?: string;
  distanceKm?: number;
  bidUrl: string;
}): messagingApi.FlexMessage {
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
          text: params.dropoffAddress || '抵達後告知或跳表',
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

  // 預估車資欄位（醒目金色高亮）
  if (params.estimatedFare !== undefined) {
    const fareText = params.estimatedFare !== null
      ? `$${params.estimatedFare}`
      : (params.fareBreakdown || '專人報價');
    const detailText = params.estimatedFare !== null && params.fareBreakdown
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
      color: '#06c755',
      height: 'md',
      action: {
        type: 'uri',
        label: '⚡ 立刻接單 (測算時間)',
        uri: params.bidUrl,
      },
    }
  );

  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1e293b', // 深藍色沉穩高級
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
              text: '⚡ 新派單廣播 (市區搭乘)',
              color: '#38bdf8',
              weight: 'bold',
              size: 'sm',
            },
            {
              type: 'text',
              text: '60秒搶單中',
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
    altText: `⚡ 新派單需求：${params.pickupAddress}`,
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
        backgroundColor: '#525252', // 附圖深灰底色
      },
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#525252',
      paddingAll: '20px',
      spacing: 'md',
      contents: [
        {
          type: 'text',
          text: 'MG&MD 優質司機',
          color: '#ffffff',
          size: 'lg',
          weight: 'bold',
        },
        {
          type: 'separator',
          color: '#a3a3a3',
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
                { type: 'text', text: '駕駛：', color: '#e5e5e5', size: 'md', flex: 3 },
                { type: 'text', text: params.driverName, color: '#ffffff', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '車型：', color: '#e5e5e5', size: 'md', flex: 3 },
                { type: 'text', text: params.carBrand, color: '#ffffff', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '車號：', color: '#e5e5e5', size: 'md', flex: 3 },
                { type: 'text', text: params.plateNumber, color: '#ffffff', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '車色：', color: '#e5e5e5', size: 'md', flex: 3 },
                { type: 'text', text: params.carColor, color: '#ffffff', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '預計到達：', color: '#fde047', size: 'md', weight: 'bold', flex: 3 },
                { type: 'text', text: `約 ${params.etaMinutes} 分鐘內抵達`, color: '#fde047', size: 'md', weight: 'bold', flex: 7 },
              ],
            },
          ],
        },
        {
          type: 'separator',
          color: '#a3a3a3',
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
              color: '#f5f5f5',
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
 * 司機群組派單結單廣播卡片（附目的地 Google Maps 連結）
 */
export function createGroupOrderAssignedFlexMessage(params: {
  driverName: string;
  orderId: string;
  pickupAddress: string;
  dropoffAddress?: string | null;
  passengerCount: number;
  etaMinutes: number;
  scheduledTimeText?: string;
}): messagingApi.FlexMessage {
  const destination = params.dropoffAddress || params.pickupAddress;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
  const pickupMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(params.pickupAddress)}`;

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
            label: '📍 開啟 Google Maps 導航',
            uri: mapUrl,
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
          text: '請接單司機盡速前往接送，祝行車平安！感謝各位司機配合。',
          color: '#94a3b8',
          size: 'xxs',
          align: 'center',
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

