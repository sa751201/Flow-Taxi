import { webhook } from '@line/bot-sdk';
import { getLineClient } from '../services/line-client.js';
import { query } from '../db/index.js';
import { env } from '../config/env.js';
import { parseDriverRegistrationText } from '../services/driver-parser.js';
import { upsertDriver, getDriverById } from '../db/queries/drivers.js';
import { createDriverRegisterFlexMessage, createWelcomeServiceMessage, createCityRidePromptMessage } from '../services/flex-messages.js';

type WebhookEvent = webhook.Event;

export async function handleLineEvents(events: WebhookEvent[]) {
  const lineClient = getLineClient();

  for (const event of events) {
    try {
      console.log(`[LINE Webhook] Event Type: ${event.type}`);

      // 取得註冊 LIFF 網址
      const registerUrl = env.LIFF_ID
        ? `https://liff.line.me/${env.LIFF_ID}/driver/register`
        : 'https://flow-taxi-production.up.railway.app/driver/register';

      // ==========================================
      // A. 處理 Postback 事件 (例如點擊「修改已登記資料」)
      // ==========================================
      if (event.type === 'postback') {
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;
        const data = event.postback.data;
        const senderUserId = event.source?.userId;

        if (data === 'action=check_or_edit_driver') {
          if (!senderUserId) {
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 無法取得您的 LINE User ID，請確認是否已加官方帳號為好友或直接點擊「填寫登記資料」。' }],
            });
            continue;
          }

          // 查詢資料庫中是否有該司機
          const driver = await getDriverById(senderUserId);

          if (!driver || !driver.registered) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 系統查無您的司機登記紀錄。\n\n請您先點擊下方連結完成初次登記：\n${registerUrl}`,
                },
              ],
            });
          } else {
            // 已有資料，提示目前登記內容並提供修改頁面
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `📋 您目前登記的資料如下：\n\n👤 駕駛姓名：${driver.display_name || '未填'}\n🔢 車牌號碼：${driver.plate_number || '未填'}\n🎨 車輛顏色：${driver.car_color || '未填'}\n🚙 車輛廠牌：${driver.car_brand || '未填'}\n📞 聯絡電話：${driver.phone || '未填'}\n\n若需修改，請點擊下方專屬頁面直接更新：\n${registerUrl}`,
                },
              ],
            });
          }
          continue;
        }

        if (data === 'action=service_select&service=city_ride') {
          await lineClient.replyMessage({
            replyToken,
            messages: [createCityRidePromptMessage()],
          });
          continue;
        }
      }

      // ==========================================
      // B. 處理加好友 / 追蹤事件 (follow) ➔ 發送歡迎詞與 6 大服務 Quick Reply
      // ==========================================
      if (event.type === 'follow') {
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;
        console.log(`🎉 [LINE Follow] 有新使用者加入官方帳號好友！userId: ${event.source?.userId}`);

        await lineClient.replyMessage({
          replyToken,
          messages: [createWelcomeServiceMessage()],
        });
        continue;
      }

      // ==========================================
      // C. 處理新成員加入群組事件 (memberJoined)
      // ==========================================
      if (event.type === 'memberJoined' && event.source && event.source.type === 'group') {
        const groupSource = event.source as webhook.GroupSource;
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;

        const joinedMembers = event.joined.members || [];
        console.log(`👋 [LINE Member Joined] 有 ${joinedMembers.length} 位新成員加入群組: ${groupSource.groupId}`);

        await lineClient.replyMessage({
          replyToken,
          messages: [
            createDriverRegisterFlexMessage(registerUrl),
          ],
        });
        continue;
      }

      // ==========================================
      // C. 處理 OA 本身被加入群組事件 (join)
      // ==========================================
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
                text: `🚕 叫車派單系統已連線！\n本群組 ID:\n${groupId}\n\n所有新加入群組的司機夥伴，請回覆車輛資料以開通接單資格。輸入「填資料」可隨時呼叫登記卡片。`,
              },
            ],
          });
        }
        continue;
      }

      // ==========================================
      // D. 處理文字訊息
      // ==========================================
      if (event.type === 'message' && event.message.type === 'text' && event.source) {
        const text = event.message.text.trim();
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;

        const senderUserId = event.source.userId;

        // 1. 群組或個人中輸入「填資料」或「登記」➔ 彈出 Flex Message
        if (text === '填資料' || text === '登記' || text === '司機登記') {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              createDriverRegisterFlexMessage(registerUrl),
            ],
          });
          continue;
        }

        // 2. 使用者直接輸入「修改資料」文字指令
        if (text === '修改資料') {
          if (!senderUserId) {
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 無法取得您的 LINE User ID，請先加官方帳號為好友或直接開啟登記頁面。' }],
            });
            continue;
          }

          const driver = await getDriverById(senderUserId);
          if (!driver || !driver.registered) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 系統查無您的司機登記紀錄。\n\n請您先點擊下方連結完成初次登記：\n${registerUrl}`,
                },
              ],
            });
          } else {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `📋 您目前登記的資料如下：\n\n👤 駕駛姓名：${driver.display_name || '未填'}\n🔢 車牌號碼：${driver.plate_number || '未填'}\n🎨 車輛顏色：${driver.car_color || '未填'}\n🚙 車輛廠牌：${driver.car_brand || '未填'}\n📞 聯絡電話：${driver.phone || '未填'}\n\n若需修改，請點擊下方專屬頁面直接更新：\n${registerUrl}`,
                },
              ],
            });
          }
          continue;
        }

        // 3. 嘗試比對是否符合「司機車輛資料登記範本 (文字直填)」
        const parsedDriver = parseDriverRegistrationText(text);
        if (parsedDriver && senderUserId) {
          console.log(`🚗 [司機文字登記成功] 司機 ${senderUserId} 登記資料:`, parsedDriver);

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
                text: `✅【${saved.display_name || '夥伴'}】你的司機資料已經建立完成！\n\n🚙 車型：${saved.car_brand || '未填'}\n🔢 車號：${saved.plate_number || '未填'}\n🎨 車色：${saved.car_color || '未填'}\n\n已為您正式開通派單接單權限！若日後需變更資料，隨時輸入「填資料」即可調整。`,
              },
            ],
          });
          continue;
        }

        // 4. 個人 1:1 聊天室指令 (Ping / 查 ID / 6大服務點擊 / 預設回覆)
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
          } else if (text.includes('市區搭乘')) {
            // 輸入「市區搭乘」時的回覆
            await lineClient.replyMessage({
              replyToken,
              messages: [createCityRidePromptMessage()],
            });
          } else if (
            text.includes('機場接送') ||
            text.includes('酒後代駕') ||
            text.includes('代購代送') ||
            text.includes('包車服務') ||
            text.includes('搬運服務')
          ) {
            // 點擊其他服務按鈕時的引導回覆
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `您選擇了【${text}】服務 🚕\n\n請直接輸入您的：\n1. 上車地點\n2. 下車地點\n3. 乘車時間與人數\n\n派單專員將立即為您安排優質司機！`,
                },
              ],
            });
          } else {
            // 1:1 聊天室預設回覆：發送完整歡迎詞與 6 大服務 Quick Reply 按鈕
            await lineClient.replyMessage({
              replyToken,
              messages: [createWelcomeServiceMessage()],
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
