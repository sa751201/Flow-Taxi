import { webhook } from '@line/bot-sdk';
import { getLineClient } from '../services/line-client.js';
import { query } from '../db/index.js';
import { env } from '../config/env.js';
import { parseDriverRegistrationText } from '../services/driver-parser.js';
import { upsertDriver, getDriverById } from '../db/queries/drivers.js';
import { createDriverRegisterFlexMessage, createWelcomeServiceMessage, createCityRidePromptMessage, createGroupDispatchOrderFlexMessage } from '../services/flex-messages.js';
import { geocodeAddress } from '../services/google-maps.js';
import { createOrder } from '../db/queries/orders.js';
import { dispatchEngine } from '../app.js';

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
          } else if (
            (text.includes('上車地點') || text.includes('1.')) &&
            (text.includes('下車地點') || text.includes('2.'))
          ) {
            // ==========================================
            // 乘客送出叫車資訊 (3 點格式解析與派單)
            // ==========================================
            // 1. 立即回覆乘客：正在聯絡司機中，1 分鐘內將回覆
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '正在聯絡司機中，1 分鐘內將回覆',
                },
              ],
            });

            // 非同步進行 Geocoding、建單與群組廣播 (不卡住 reply)
            (async () => {
              try {
                // 簡易萃取上車地點、下車地點、人數/時間
                let pickupAddr = '';
                let dropoffAddr = '';
                let timeAndCount = '';

                const lines = text.split('\n');
                for (const line of lines) {
                  const cleaned = line.trim();
                  if (cleaned.includes('上車地點')) {
                    pickupAddr = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[上車地點]+[\s：:]*/, '').trim();
                  } else if (cleaned.includes('下車地點')) {
                    dropoffAddr = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[下車地點]+[\s：:]*/, '').trim();
                  } else if (cleaned.includes('乘車時間') || cleaned.includes('人數') || cleaned.includes('3.')) {
                    timeAndCount = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[乘車時間與人數]+[\s：:]*/, '').trim();
                  }
                }

                if (!pickupAddr) pickupAddr = '台北市區 (指定上車點)';

                // 確保 customer 存在 (避免外鍵約束失敗)
                const customerId = userSource.userId;
                try {
                  await query(
                    `INSERT INTO customers (line_user_id, display_name) VALUES ($1, 'LINE 乘客') ON CONFLICT (line_user_id) DO NOTHING;`,
                    [customerId]
                  );
                } catch (cErr: any) {
                  console.warn('[Line Webhook] Customer upsert warning:', cErr.message);
                }

                // 呼叫 Google Geocoding 取得經緯度
                const geo = await geocodeAddress(pickupAddr);

                // 建立訂單 (status: pending)
                const newOrder = await createOrder({
                  customer_id: customerId || 'UNKNOWN_CUSTOMER',
                  service_type: 'city',
                  pickup_address: pickupAddr,
                  pickup_lat: geo.lat,
                  pickup_lng: geo.lng,
                  dropoff_address: dropoffAddr || undefined,
                  note: timeAndCount || undefined,
                });

                console.log(`[Line Webhook] 訂單 ${newOrder.id} 建立成功！`);

                // 啟動派單收集視窗 (60 秒)
                await dispatchEngine.startDispatch(newOrder.id, 60);

                // 司機接單 LIFF 網址
                const bidUrl = env.LIFF_ID
                  ? `https://liff.line.me/${env.LIFF_ID}/driver/bid?orderId=${newOrder.id}`
                  : `https://flow-taxi-production.up.railway.app/driver/bid?orderId=${newOrder.id}`;

                // 群組廣播 Flex Message
                const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
                if (targetGroupId) {
                  const dispatchFlex = createGroupDispatchOrderFlexMessage({
                    orderId: newOrder.id,
                    pickupAddress: pickupAddr,
                    dropoffAddress: dropoffAddr || undefined,
                    scheduledTimeText: timeAndCount || '即刻出發',
                    bidUrl,
                  });

                  await lineClient.pushMessage({
                    to: targetGroupId,
                    messages: [dispatchFlex],
                  });
                  console.log(`[Line Webhook] 成功向司機群組 ${targetGroupId} 廣播派單卡片！`);
                }
              } catch (dispatchErr: any) {
                console.error('[Line Webhook] 派單建立廣播失敗:', dispatchErr);
              }
            })();
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
