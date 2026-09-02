import { webhook } from '@line/bot-sdk';
import { getLineClient } from '../services/line-client.js';
import { query } from '../db/index.js';

type WebhookEvent = webhook.Event;

export async function handleLineEvents(events: WebhookEvent[]) {
  const lineClient = getLineClient();

  for (const event of events) {
    try {
      console.log(`[LINE Webhook] Event Type: ${event.type}`);

      // 1. 處理 OA 被加入群組事件 (抓取 DRIVER_GROUP_ID)
      if (event.type === 'join' && event.source && event.source.type === 'group') {
        const groupSource = event.source as webhook.GroupSource;
        const groupId = groupSource.groupId;
        console.log(`🎉 [LINE Group Join] OA 被加入群組！GroupId: ${groupId}`);

        // 寫入 driver_groups 資料表 (防重)
        try {
          await query(
            `INSERT INTO driver_groups (group_id, name, created_at)
             VALUES ($1, $2, now())
             ON CONFLICT (group_id) DO NOTHING`,
            [groupId, '司機接單群組']
          );
          console.log(`[DB] 成功將 group_id ${groupId} 記錄至 driver_groups`);
        } catch (dbErr: any) {
          console.warn(`[DB] 記錄群組至 driver_groups 提示: ${dbErr.message}`);
        }

        // 在群組打個招呼並回報 GroupId
        if ('replyToken' in event && event.replyToken) {
          await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: `🚕 叫車派單系統已連線！\n本群組 ID:\n${groupId}\n\n請將此 ID 填入 .env 的 DRIVER_GROUP_ID。`,
              },
            ],
          });
        }
      }

      // 2. 處理文字訊息 (Echo / Ping-Pong 測試)
      if (event.type === 'message' && event.message.type === 'text' && event.source) {
        const text = event.message.text.trim();
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;

        // 如果在個人 1:1 聊天室
        if (event.source.type === 'user') {
          const userSource = event.source as webhook.UserSource;
          if (text.toLowerCase() === 'ping') {
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '🏓 pong! 叫車系統正常運行中。' }],
            });
          } else if (text === '查id' || text.toLowerCase() === 'id') {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `👤 您的 LINE User ID:\n${userSource.userId}`,
                },
              ],
            });
          } else {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `🚕 您好！我是叫車派單機器人。\n您傳送了：「${text}」\n\n目前系統已成功與 LINE 官方帳號連動！輸入「ping」或「查id」可進行測試。`,
                },
              ],
            });
          }
        } else if (event.source.type === 'group') {
          const groupSource = event.source as webhook.GroupSource;
          // 群組訊息：僅在有人輸入 "!groupid" 或 "!群組id" 時回覆
          if (text === '!groupid' || text === '!群組id') {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `🚕 本群組 ID:\n${groupSource.groupId}`,
                },
              ],
            });
          }
        }
      }
    } catch (err: any) {
      console.error('[LINE Webhook] 處理單一事件錯誤:', err);
    }
  }
}
