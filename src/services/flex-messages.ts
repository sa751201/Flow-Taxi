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
 * 符合深藍色圓角膠囊按鈕樣式
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

  const services = [
    { label: '市區搭乘🚗', text: '市區搭乘🚗' },
    { label: '機場接送✈️', text: '機場接送✈️' },
    { label: '酒後代駕🍺', text: '酒後代駕🍺' },
    { label: '代購代送🛍️', text: '代購代送🛍️' },
    { label: '包車服務🚙', text: '包車服務🚙' },
    { label: '搬運服務🧳', text: '搬運服務🧳' },
  ];

  const quickReplyItems: messagingApi.QuickReplyItem[] = services.map((s) => ({
    type: 'action',
    action: {
      type: 'message',
      label: s.label,
      text: s.text,
    },
  }));

  return {
    type: 'text',
    text: welcomeText,
    quickReply: {
      items: quickReplyItems,
    },
  };
}
