import { messagingApi } from '@line/bot-sdk';

/**
 * 建立「司機資料登記 / 修改」的 Flex Message 卡片
 */
export function createDriverRegisterFlexMessage(registerUrl: string): messagingApi.FlexMessage {
  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#18181b',
      paddingAll: '16px',
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
              color: '#f59e0b',
              size: 'xs',
              weight: 'bold',
            },
          ],
        },
        {
          type: 'text',
          text: '🚕 司機夥伴資料維護',
          color: '#ffffff',
          size: 'lg',
          weight: 'bold',
          margin: 'sm',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#27272a',
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        {
          type: 'text',
          text: '為了確保派單資訊精確與乘車辨識順暢，請司機夥伴隨時保持最新車輛資訊（姓名、車牌、車色、廠牌）。',
          color: '#d4d4d8',
          size: 'sm',
          wrap: true,
        },
        {
          type: 'separator',
          color: '#3f3f46',
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#f59e0b',
              height: 'sm',
              action: {
                type: 'uri',
                label: '📝 填寫登記資料',
                uri: registerUrl,
              },
            },
            {
              type: 'button',
              style: 'secondary',
              color: '#3f3f46',
              height: 'sm',
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
      backgroundColor: '#18181b',
      paddingAll: '12px',
      contents: [
        {
          type: 'text',
          text: '🔒 身分由 LINE 安全驗證，資料僅供派單對接使用',
          color: '#71717a',
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
