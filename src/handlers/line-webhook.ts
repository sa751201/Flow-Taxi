import { webhook } from '@line/bot-sdk';
import { getLineClient } from '../services/line-client.js';
import { query } from '../db/index.js';
import { env } from '../config/env.js';
import { parseDriverRegistrationText } from '../services/driver-parser.js';
import { upsertDriver } from '../db/queries/drivers.js';

type WebhookEvent = webhook.Event;

export async function handleLineEvents(events: WebhookEvent[]) {
  const lineClient = getLineClient();

  for (const event of events) {
    try {
      console.log(`[LINE Webhook] Event Type: ${event.type}`);

      // A. 處理新成員加入群組事件 (memberJoined)
      if (event.type === 'memberJoined' && event.source && event.source.type === 'group') {
        const groupSource = event.source as webhook.GroupSource;
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;

        const joinedMembers = event.joined.members || [];
        console.log(`👋 [LINE Member Joined] 有 ${joinedMembers.length} 位新成員加入群組: ${groupSource.groupId}`);

        // 產生 LIFF 註冊連結
        const liffRegisterUrl = env.LIFF_ID
          ? `https://liff.line.me/${env.LIFF_ID}/driver/register`
          : '/driver/register.html';

        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: `🚕 歡迎新夥伴加入司機派單群！\n\n為了保障接單權限與乘車資訊正確，請您撥空完成資料登記。\n\n📝【登記方式一：直接於此回覆】\n\n駕駛：\n車型：\n車號：\n車色：\n\n📲【登記方式二：手機表單登記】\n您也可以點擊下方專屬頁面快速填妥：\n${liffRegisterUrl}`,
            },
          ],
        });
        continue;
      }

      // B. 處理 OA 本身被加入群組事件 (join)
      if (event.type === 'join' && event.source && event.source.type === 'group') {
        const groupSource = event.source as webhook.GroupSource;
        const groupId = groupSource.groupId;
        console.log(`🎉 [LINE Group Join] OA 被加入群組！GroupId: ${groupId}`);

        try {
          await query(
            `INSERT INTO driver_groups (group_id, name, created_at)
             VALUES ($1, $2, now())
             ON CONFLICT (group_id) DO NOTHING`,
            [groupId, '司機接單群組']
          );
        } catch (dbErr: any) {
          console.warn(`[DB] 記錄群組提示: ${dbErr.message}`);
        }

        if ('replyToken' in event && event.replyToken) {
          await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: `🚕 叫車派單系統已連線！\n本群組 ID:\n${groupId}\n\n所有新加入群組的司機夥伴，請回覆車輛資料以開通接單資格。`,
              },
            ],
          });
        }
        continue;
      }

      // C. 處理文字訊息 (包含司機文字登記辨識)
      if (event.type === 'message' && event.message.type === 'text' && event.source) {
        const text = event.message.text.trim();
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;

        const senderUserId = event.source.userId;

        // 1. 嘗試比對是否符合「司機車輛資料登記範本」
        const parsedDriver = parseDriverRegistrationText(text);
        if (parsedDriver && senderUserId) {
          console.log(`🚗 [司機文字登記成功] 司機 ${senderUserId} 登記資料:`, parsedDriver);

          // 寫入 Supabase 資料庫
          const saved = await upsertDriver({
            line_user_id: senderUserId,
            display_name: parsedDriver.displayName,
            plate_number: parsedDriver.plateNumber,
            car_color: parsedDriver.carColor,
            car_brand: parsedDriver.carBrand,
            phone: parsedDriver.phone,
            registered: true,
            status: 'active',
          });

          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: `✅ 司機資料已成功建檔！\n\n👤 駕駛：${saved.display_name || '未填'}\n🚙 車型：${saved.car_brand || '未填'}\n🔢 車號：${saved.plate_number || '未填'}\n🎨 車色：${saved.car_color || '未填'}\n\n已為您開通派單接單權限！`,
              },
            ],
          });
          continue;
        }

        // 2. 個人 1:1 聊天室指令
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
          } else if (text === '司機登記' || text === '登記') {
            const liffRegisterUrl = env.LIFF_ID
              ? `https://liff.line.me/${env.LIFF_ID}/driver/register`
              : '/driver/register.html';
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `🚕 司機夥伴資料登記：\n請點擊下方連結開啟專屬登記頁面：\n${liffRegisterUrl}`,
                },
              ],
            });
          } else {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `🚕 您好！我是叫車派單機器人。\n輸入「司機登記」可開通接單資格，或輸入「ping」測試系統。`,
                },
              ],
            });
          }
        } else if (event.source.type === 'group') {
          const groupSource = event.source as webhook.GroupSource;
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
