import { webhook, messagingApi } from '@line/bot-sdk';
import { getLineClient } from '../services/line-client.js';
import { query } from '../db/index.js';
import { env } from '../config/env.js';
import { parseDriverRegistrationText } from '../services/driver-parser.js';
import { upsertDriver, getDriverById, addDriverCompensationPoint } from '../db/queries/drivers.js';
import {
  createDriverRegisterFlexMessage,
  createWelcomeServiceMessage,
  createCityRidePromptMessage,
  createAirportRidePromptMessage,
  createGroupDispatchOrderFlexMessage,
  createDriverOrderCardFlexMessage,
  createGroupOrderCancelledFlexMessage,
  createCustomerReservationStatusFlexMessage,
  CustomerReservationStatusItem,
  createDriverBoardedFareConfirmFlexMessage,
  createGroupOrderCompletedFlexMessage,
  createPassengerArrivalReplyFlexMessage,
} from '../services/flex-messages.js';
import { geocodeAddress } from '../services/google-maps.js';
import {
  createOrder,
  getActiveOrderByDriverId,
  getActiveOrderByCustomerId,
  getActiveOrdersByCustomerId,
  getActiveReservationOrdersByCustomerId,
  getScheduledOrdersByDriverId,
  getOrderById,
  updateOrderStatus,
  updateOrderNote,
  markDriverArrived,
  markReservationBroadcasted,
  acknowledgeReservationOrder,
  isDetailedDropoffAddress,
  getOrderDefaultFare,
  completeOrderWithFare,
  extractFixedRoute,
  Order,
} from '../db/queries/orders.js';
import { matchRegularCustomerRoute } from '../db/queries/regular-customers.js';
import {
  evaluateShortTripOnCompletion,
  notifyShortTripForVerification,
} from '../services/short-trip-verifier.js';
import {
  startCustomerChatSession,
  endCustomerChatSession,
  getCustomerChatOrderId,
  isCustomerInChatSession,
  resolveOrderForCommunication,
  forwardMessageToDriver,
  forwardMessageToPassenger,
} from '../services/order-chat.js';
import { linkDriverRichMenu, syncUserRichMenuByRole } from '../services/rich-menu.js';
import { dispatchEngine } from '../app.js';
import { calculateFare } from '../services/fare-calculator.js';
import { isGroupAllowed, isAdminGroup } from '../services/group-whitelist.js';
import { handleAdminGroupCommand, isManualTakeoverActive } from '../services/admin-control.js';
import { checkSilentQuestion, createSilentAlertForAdmin } from '../services/silent-questions.js';
import { aggregateDailyStats, createDailyReportFlexMessage } from '../services/daily-reporter.js';
import {
  parseScheduledTimeString,
  isFutureReservation,
  extractScheduledTimeText,
  hasDriverAck,
  evaluateReservationDispatchAction,
} from '../services/reservation.js';
import {
  checkAndSendReservationReminders,
  reopenReservationOrder,
} from '../services/reservation-reminder.js';

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

        if (data === 'action=service_select&service=airport_ride') {
          await lineClient.replyMessage({
            replyToken,
            messages: [createAirportRidePromptMessage()],
          });
          continue;
        }

        // 司機點擊預約單「✅ 我知道了」確認按鈕
        if (data.startsWith('action=ack_reservation')) {
          const params = new URLSearchParams(data);
          const ackOrderId = params.get('orderId') || '';
          if (!ackOrderId) continue;

          const ackRes = await acknowledgeReservationOrder(ackOrderId, senderUserId);
          if (!ackRes.success) {
            if (ackRes.reason === 'not_winner') {
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: `⚠️ 此筆預約單（#${ackOrderId.slice(-4)}）是由其他司機夥伴承接，僅接單司機本人可點擊「我知道了」確認喔！`,
                  },
                ],
              });
            } else {
              await lineClient.replyMessage({
                replyToken,
                messages: [{ type: 'text', text: '⚠️ 找不到該筆預約訂單或已結束。' }],
              });
            }
            continue;
          }

          const scheduledText = ackRes.order ? extractScheduledTimeText(ackRes.order) : '';
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: `✅【已收到「我知道了」確認】\n您已確認承接預約訂單 #${ackOrderId.slice(-4)}（預約時間：${scheduledText}）。\n系統將於預約單前 1 小時，在您的 1:1 官方帳號通知您前往上車地點載客（並附完整訂單資訊 Flex Message）！🚖`,
              },
            ],
          });

          // 若預約時間已進入前 1 小時內，立即觸發檢查發送出車通知
          checkAndSendReservationReminders().catch(() => {});
          continue;
        }

        // 管理員點擊「🔄 重啟預約單」按鈕（針對超過 1 小時未按我知道了之預約單）
        if (data.startsWith('action=admin_reopen_reservation')) {
          const params = new URLSearchParams(data);
          const reopenOrderId = params.get('orderId') || '';
          if (!reopenOrderId) continue;

          const reopenRes = await reopenReservationOrder(reopenOrderId);
          if (!reopenRes.success) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 無法重啟預約單 #${reopenOrderId.slice(-4)}：${reopenRes.error}`,
                },
              ],
            });
            continue;
          }

          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: `🔄【已重啟預約單 #${reopenOrderId.slice(-4)}】\n已解除原司機指派並重新於司機群組廣播派單，尋找其他司機處理！`,
              },
            ],
          });
          continue;
        }

        // 司機點擊「確認金額並回報」按鈕：視同回報結單，並傳送至 chatroom 群組顯示訂單已完結與金額
        if (data.startsWith('action=confirm_fare_complete')) {
          const params = new URLSearchParams(data);
          const completeOrderId = params.get('orderId') || '';
          const rawFare = params.get('fare');
          if (!completeOrderId) continue;

          const existingOrder = await getOrderById(completeOrderId);
          if (!existingOrder) {
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 找不到該筆訂單。' }],
            });
            continue;
          }

          if (senderUserId && existingOrder.driver_id && existingOrder.driver_id !== senderUserId) {
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 僅本筆訂單之接單司機可回報結單。' }],
            });
            continue;
          }

          const finalFare = rawFare && Number(rawFare) > 0
            ? Math.round(Number(rawFare))
            : getOrderDefaultFare(existingOrder);

          if (finalFare === null || finalFare <= 0) {
            const requiredFareCard = createDriverBoardedFareConfirmFlexMessage({
              orderId: existingOrder.id,
              pickupAddress: existingOrder.pickup_address,
              dropoffAddress: existingOrder.dropoff_address,
              passengerCount: existingOrder.passenger_count || 1,
              fare: null,
            });
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '⚠️ 此筆訂單乘客未提供詳細下車地址，回報下車時「填寫金額」為必填！請點選下方按鈕填寫本趟實際金額以完成結單回報：',
                },
                requiredFareCard,
              ],
            });
            continue;
          }

          const completedOrder = await completeOrderWithFare(completeOrderId, finalFare);
          if (!completedOrder) continue;

          if (completedOrder.customer_id && getCustomerChatOrderId(completedOrder.customer_id) === completedOrder.id) {
            endCustomerChatSession(completedOrder.customer_id);
          }

          const effectiveDriverId = completedOrder.driver_id || senderUserId || 'UNKNOWN_DRIVER';
          const driverProfile = effectiveDriverId !== 'UNKNOWN_DRIVER'
            ? await getDriverById(effectiveDriverId)
            : null;
          const driverName = driverProfile?.display_name || '司機夥伴';

          // 偵測上車地點與下車地點距離，若小於 5 公里即算短程單
          const shortTripEval = await evaluateShortTripOnCompletion({
            order: completedOrder,
          });

          // 1. 推播至司機群組 (chatroom)：這筆訂單已完結，並顯示金額
          const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
          if (targetGroupId) {
            try {
              const groupCompletedFlex = createGroupOrderCompletedFlexMessage({
                orderId: completedOrder.id,
                driverName,
                pickupAddress: completedOrder.pickup_address,
                dropoffAddress: completedOrder.dropoff_address,
                fare: finalFare,
                isAdjusted: false,
              });
              await lineClient.pushMessage({
                to: targetGroupId,
                messages: [groupCompletedFlex],
              });
              console.log(`[Confirm Fare Complete] ✅ 已向司機群組推播訂單 #${completedOrder.id.slice(-4)} 完結與金額 $${finalFare}`);
            } catch (gErr: any) {
              console.warn('[Confirm Fare Complete] 推播司機群組結單失敗:', gErr.message);
            }
          }

          // 2. 回覆司機 1:1 OA 結單確認（依需求，結單金額回報無須推播客人的 1:1 OA；若偵測為短程單，附上短程單提示 Flex Message 並發送管理群組核實 Flex Message）
          const replyMessages: messagingApi.Message[] = [
            {
              type: 'text',
              text: `🎉【訂單已完結並回報群組】\n\n🧾 訂單編號：#${completedOrder.id.slice(-4)}\n🟢 上車：${completedOrder.pickup_address}\n🔴 下車：${completedOrder.dropoff_address || '乘客指定地點'}\n💰 結單金額：$${finalFare}\n\n已同步將完結與金額回報至聊天室群組！辛苦司機夥伴了，祝行車平安！🚖`,
            },
          ];

          if (shortTripEval.isShortTrip && shortTripEval.dropoffAddress && shortTripEval.distanceKm !== null) {
            const { driverFlex } = await notifyShortTripForVerification({
              order: completedOrder,
              driverId: effectiveDriverId,
              driverName,
              dropoffAddress: shortTripEval.dropoffAddress,
              distanceKm: shortTripEval.distanceKm,
              fare: finalFare,
              pushToDriver: false,
            });
            replyMessages.push(driverFlex);
          }

          await lineClient.replyMessage({
            replyToken,
            messages: replyMessages,
          });
          continue;
        }

        // 管理員於管理群組點擊「核實通過 / 駁回」短程單補單點數
        if (data.startsWith('action=admin_verify_short_trip')) {
          const params = new URLSearchParams(data);
          const verifyOrderId = params.get('orderId') || '';
          const verifyDriverId = params.get('driverId') || '';
          const approved = params.get('approved') === '1';
          if (!verifyOrderId || !verifyDriverId) continue;

          const targetOrder = await getOrderById(verifyOrderId);
          if (
            targetOrder?.note?.includes('[SHORT_TRIP_VERIFIED]') ||
            targetOrder?.note?.includes('[SHORT_TRIP_REJECTED]')
          ) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `ℹ️ 短程單 #${verifyOrderId.slice(-4)} 先前已由管理員完成核實處理，無須重複操作。`,
                },
              ],
            });
            continue;
          }

          const driverProfile = await getDriverById(verifyDriverId);
          const driverName = driverProfile?.display_name || '司機夥伴';

          if (approved) {
            const newPoints = await addDriverCompensationPoint(verifyDriverId, 1);
            if (targetOrder) {
              const nextNote = `${targetOrder.note || ''} [SHORT_TRIP_VERIFIED]`.trim();
              targetOrder.note = nextNote;
              await updateOrderNote(verifyOrderId, nextNote);
            }

            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `✅【短程單核實通過】\n訂單 #${verifyOrderId.slice(-4)} 已核實為短程單，系統已為司機【${driverName}】發放 +1 點補單點數（目前可用：${newPoints} 點）！`,
                },
              ],
            });

            if (!verifyDriverId.startsWith('DEV_DRIVER_')) {
              try {
                await lineClient.pushMessage({
                  to: verifyDriverId,
                  messages: [
                    {
                      type: 'text',
                      text: `🎁【短程單核實通過・獲得補單點數】\n管理員已核實您的短程單（訂單 #${verifyOrderId.slice(-4)}），系統已為您發放 +1 點【補單點數】（目前可用：${newPoints} 點）！\n下次接單時勾選「使用補單點數」，喊單當下即可立即結單中單，不用再等 30 秒規則！🚖`,
                    },
                  ],
                });
              } catch (dErr: any) {
                console.warn('[Admin Verify Short Trip] 推播司機補單點數通知失敗:', dErr.message);
              }
            }
          } else {
            if (targetOrder) {
              const nextNote = `${targetOrder.note || ''} [SHORT_TRIP_REJECTED]`.trim();
              targetOrder.note = nextNote;
              await updateOrderNote(verifyOrderId, nextNote);
            }

            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `❌【已駁回短程單 #${verifyOrderId.slice(-4)}】\n本筆訂單不發放補單點數。`,
                },
              ],
            });
          }
          continue;
        }
      }

      // ==========================================
      // B. 處理加好友 / 追蹤事件 (follow) ➔ 發送歡迎詞與 6 大服務 Quick Reply
      // ==========================================
      if (event.type === 'follow') {
        const replyToken = 'replyToken' in event ? event.replyToken : undefined;
        if (!replyToken) continue;
        const followerUserId = event.source?.userId;
        console.log(`🎉 [LINE Follow] 有新使用者加入官方帳號好友！userId: ${followerUserId}`);

        // 自動連線資料庫判斷身份並指派對應 Rich Menu (司機 vs 乘客)
        if (followerUserId) {
          syncUserRichMenuByRole(followerUserId).catch((rmErr) => {
            console.warn('[LINE Follow] 自動同步 Rich Menu 失敗:', rmErr.message);
          });
        }

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

        const isAllowed = isGroupAllowed(groupId);

        if (!isAllowed) {
          console.warn(`⛔ [Group Whitelist] 群組 ${groupId} 不在允許白名單內！發送拒絕通知並退出群組。`);
          if ('replyToken' in event && event.replyToken) {
            await lineClient.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️【未授權的司機群組】\n\n感謝您的邀請！本派單系統目前僅提供給通過審核之合作車隊群組使用。\n\n本群組 ID 為：\n${groupId}\n\n若需開通車隊自動化派單功能，請將此群組 ID 提供給系統管理員/負責人開通授權。為維護安全，機器人將自動退出本群組。`,
                },
              ],
            });
          }

          // 安全機制：自動主動退出未授權群組
          try {
            await lineClient.leaveGroup(groupId);
            console.log(`👋 [Group Whitelist] 機器人已成功退出未授權群組: ${groupId}`);
          } catch (leaveErr: any) {
            console.warn(`[Group Whitelist] 退出群組失敗:`, leaveErr.message);
          }
          continue;
        }

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

        // 若訊息來自群組，檢查群組是否在允許白名單中
        if (event.source.type === 'group') {
          const groupId = (event.source as webhook.GroupSource).groupId;
          if (!isGroupAllowed(groupId)) {
            console.warn(`⛔ [Group Whitelist] 忽略來自未授權群組 ${groupId} 的文字訊息: "${text}"`);
            continue;
          }

          // 幹部群組專屬控制指令處理 (接管、恢復、查狀態、即時日報)
          if (isAdminGroup(groupId)) {
            // 即時日報查詢
            if (['日報', '今日日報', '今日戰報', '營運日報'].includes(text.trim())) {
              const stats = await aggregateDailyStats();
              await lineClient.replyMessage({
                replyToken,
                messages: [createDailyReportFlexMessage(stats)],
              });
              continue;
            }

            // 幹部模式切換與狀態查詢
            let senderName = '幹部';
            if (senderUserId) {
              try {
                const profile = await lineClient.getGroupMemberProfile(groupId, senderUserId);
                senderName = profile.displayName;
              } catch {
                // 忽略個人名稱解析失敗
              }
            }
            const adminReply = await handleAdminGroupCommand(text, senderName);
            if (adminReply) {
              await lineClient.replyMessage({
                replyToken,
                messages: [adminReply],
              });
              continue;
            }
          }
        }

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
                  text: `📋 您目前登記的車卡資料如下：\n\n👤 駕駛姓名：${driver.display_name || '未填'}\n🔢 車牌號碼：${driver.plate_number || '未填'}\n🎨 車輛顏色：${driver.car_color || '未填'}\n🚙 車輛廠牌：${driver.car_brand || '未填'}\n📞 聯絡電話：${driver.phone || '未填'}\n📝 車內注意事項：${driver.notes || '🚭 禁菸 🚯 禁食'}\n\n若需修改，請點擊下方專屬頁面直接更新：\n${registerUrl}`,
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
            notes: parsedDriver.notes,
            registered: true,
            status: 'active',
          });

          // 若有設定司機專屬 Rich Menu，自動為新司機綁定
          linkDriverRichMenu(senderUserId).catch((rmErr) => {
            console.warn('[Line Webhook] 司機 Rich Menu 自動綁定失敗:', rmErr.message);
          });

          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: `✅【${saved.display_name || '夥伴'}】你的司機車卡資料已經建立完成！\n\n🚙 車型：${saved.car_brand || '未填'}\n🔢 車號：${saved.plate_number || '未填'}\n🎨 車色：${saved.car_color || '未填'}\n📝 注意事項：${saved.notes || '🚭 禁菸 🚯 禁食'}\n\n已為您正式開通派單接單權限！若日後需變更資料，隨時輸入「修改資料」即可調整。`,
              },
            ],
          });
          continue;
        }

        // 4. 司機回報「到」/「到達」：車輛抵達上車地點，通知乘客
        if (text === '到' || text === '我到了' || text === '已抵達' || text === '到達') {
          if (!senderUserId) continue;

          // 需求：司機回報全面改在 1:1 OA 進行，群組內發送則提醒前往 1:1 OA
          if (event.source.type === 'group' || event.source.type === 'room') {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 為維護群組秩序，行程進度回報（到達、客上、乘客下車）請至「1:1 官方帳號」進行！\n👉 請點擊前往 1:1 OA：${env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw'}`,
                },
              ],
            });
            continue;
          }

          const activeOrder = await getActiveOrderByDriverId(senderUserId);

          if (!activeOrder) {
            console.log(`[Driver Arrival] 司機 ${senderUserId} 回報「到」，但無進行中之訂單`);
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 查無您目前進行中的接單行程。' }],
            });
            continue;
          }

          console.log(`[Driver Arrival] 司機 ${senderUserId} 已到達訂單 ${activeOrder.id} 上車地！通知乘客: ${activeOrder.customer_id}`);

          // 持久化記錄司機已到點狀態
          await markDriverArrived(activeOrder.id);

          // 透過 1:1 OA 通知乘客，附帶 Quick Reply 按鈕 (「準時」、「晚1-5分鐘」、「📞 電話聯繫」)
          if (activeOrder.customer_id) {
            try {
              const driver = await getDriverById(senderUserId);
              const driverPhone = driver?.phone?.replace(/[^0-9]/g, '');

              const quickReplyItems: messagingApi.QuickReplyItem[] = [
                {
                  type: 'action',
                  action: {
                    type: 'message',
                    label: '✅ 準時',
                    text: '準時，我正在前往上車點！',
                  },
                },
                {
                  type: 'action',
                  action: {
                    type: 'message',
                    label: '⏳ 晚1-5分鐘',
                    text: '稍微耽擱，約晚 1-5 分鐘抵達，請稍候！',
                  },
                },
              ];

              // 若司機有登記聯絡電話，掛載「📞 電話聯繫」按鈕
              if (driverPhone) {
                quickReplyItems.push({
                  type: 'action',
                  action: {
                    type: 'uri',
                    label: '📞 電話聯繫',
                    uri: `tel:${driverPhone}`,
                  },
                });
              }

              await lineClient.pushMessage({
                to: activeOrder.customer_id,
                messages: [
                  {
                    type: 'text',
                    text: '🚖 司機已抵達指定上車地，請確認車號車色後上車！\n\n⏳ 溫馨提醒：司機等待時間為您選擇的時間加上 5 分鐘緩衝（例如選「準時」，司機可等候 5 分鐘）。超過緩衝 5 分鐘後，將按每分鐘計費。',
                    quickReply: {
                      items: quickReplyItems,
                    },
                  },
                ],
              });
              console.log(`[Driver Arrival] ✅ 成功透過 1:1 OA 通知乘客已抵達 (包含電話聯繫按鈕: ${Boolean(driverPhone)}): ${activeOrder.customer_id}`);
            } catch (notifyErr: any) {
              console.error('[Driver Arrival] 通知乘客失敗:', notifyErr.message);
            }
          }

          // 1:1 回覆司機確認訊息，下方附帶 Quick Reply 按鈕「客上」與「客人未出現」
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '✅ 已收到到點回報！系統已透過 1:1 OA 通知乘客「司機已抵達」，請耐心等候乘客上車。',
                quickReply: {
                  items: [
                    {
                      type: 'action',
                      action: {
                        type: 'message',
                        label: '🚕 客上',
                        text: '客上',
                      },
                    },
                    {
                      type: 'action',
                      action: {
                        type: 'message',
                        label: '🚫 客人未出現',
                        text: '客人未出現',
                      },
                    },
                  ],
                },
              },
            ],
          });
          continue;
        }

        // 4.5 司機回報「客人未出現」：取消訂單並為司機後台計點 +1 點補單點數
        if (
          text === '客人未出現' ||
          text === '未出現' ||
          text === '乘客未出現' ||
          text === '客人沒出現' ||
          text === '空趟'
        ) {
          if (!senderUserId) continue;

          if (event.source.type === 'group' || event.source.type === 'room') {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 為維護群組秩序，行程進度回報（到達、客上、客人未出現、乘客下車）請至「1:1 官方帳號」進行！\n👉 請點擊前往 1:1 OA：${env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw'}`,
                },
              ],
            });
            continue;
          }

          const activeOrder = await getActiveOrderByDriverId(senderUserId);
          if (!activeOrder) {
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 查無您目前進行中的接單行程。' }],
            });
            continue;
          }

          await updateOrderStatus(activeOrder.id, 'cancelled');
          if (activeOrder.customer_id && getCustomerChatOrderId(activeOrder.customer_id) === activeOrder.id) {
            endCustomerChatSession(activeOrder.customer_id);
          }

          // 後台計點：為司機增加 1 點補單點數
          const newPoints = await addDriverCompensationPoint(senderUserId, 1);

          // 通知乘客訂單已因未出現而取消
          if (activeOrder.customer_id) {
            try {
              await lineClient.pushMessage({
                to: activeOrder.customer_id,
                messages: [
                  {
                    type: 'text',
                    text: `⚠️ 司機已於指定上車地（${activeOrder.pickup_address}）等候，因未見您出現，本趟叫車訂單（#${activeOrder.id.slice(-4)}）已取消。如需再次用車，請重新預約叫車。`,
                  },
                ],
              });
            } catch (custErr: any) {
              console.warn('[Passenger No-Show] 推播乘客失敗:', custErr.message);
            }
          }

          // 回覆司機確認並告知已獲得補單點數
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: `✅ 已收到「客人未出現」回報，本筆訂單（#${activeOrder.id.slice(-4)}）已取消結案。\n\n🎁 系統已自動為您補償 +1 點【補單點數】（目前可用：${newPoints} 點）！\n下次於接單頁面勾選「使用補單點數」，喊單當下即可立即結單中單，不用再等 30 秒規則！🚖`,
              },
            ],
          });
          continue;
        }

        // 5. 司機回報「客上」：乘客上車，更新狀態為 picked_up 並推播溫馨叮嚀
        if (text === '客上' || text === '客人上車' || text === '已上車') {
          if (!senderUserId) continue;

          // 需求：司機回報全面改在 1:1 OA 進行，群組內發送則提醒前往 1:1 OA
          if (event.source.type === 'group' || event.source.type === 'room') {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 為維護群組秩序，行程進度回報（到達、客上、乘客下車）請至「1:1 官方帳號」進行！\n👉 請點擊前往 1:1 OA：${env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw'}`,
                },
              ],
            });
            continue;
          }

          const activeOrder = await getActiveOrderByDriverId(senderUserId);

          if (!activeOrder) {
            console.log(`[Passenger Boarded] 司機 ${senderUserId} 回報「客上」，但無進行中之訂單`);
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 查無您目前進行中的接單行程。' }],
            });
            continue;
          }

          console.log(`[Passenger Boarded] 司機 ${senderUserId} 回報客上！訂單: ${activeOrder.id}, 乘客: ${activeOrder.customer_id}`);

          // 更新訂單狀態為 picked_up
          await updateOrderStatus(activeOrder.id, 'picked_up');

          // 1:1 OA 傳給客人完整文案
          if (activeOrder.customer_id) {
            try {
              const passengerMessage = 
`司機已回報 您上車囉
感謝搭乘 歡迎您再次預約
溫馨提醒
下車請記得隨身物品
為了您個資的安全
如有司機向您留聯絡方式
下車後請馬上告知小編
若乘車體驗不錯 歡迎分享給朋友
${env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw'}`;

              await lineClient.pushMessage({
                to: activeOrder.customer_id,
                messages: [
                  {
                    type: 'text',
                    text: passengerMessage,
                  },
                ],
              });
              console.log(`[Passenger Boarded] ✅ 成功透過 1:1 OA 推播客上溫馨提醒至乘客: ${activeOrder.customer_id}`);
            } catch (custErr: any) {
              console.error('[Passenger Boarded] 推播乘客失敗:', custErr.message);
            }
          }

          // 1:1 回覆司機確認訊息，並顯示該張訂單與金額的 Flex Message（含「確認金額並回報」與「調整訂單金額並回報」按鈕）
          const defaultFare = getOrderDefaultFare(activeOrder);
          const driverProfile = await getDriverById(senderUserId);
          const boardedFareFlex = createDriverBoardedFareConfirmFlexMessage({
            orderId: activeOrder.id,
            driverName: driverProfile?.display_name || '司機夥伴',
            pickupAddress: activeOrder.pickup_address,
            dropoffAddress: activeOrder.dropoff_address,
            passengerCount: activeOrder.passenger_count || 1,
            fare: defaultFare,
          });

          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text:
                  defaultFare !== null
                    ? '👍 已收到「客上」回報！系統已發送感謝搭乘與安全叮嚀給乘客。\n\n以下為本筆訂單與金額資訊，請於行程結束時點選「確認金額並回報」或「調整訂單金額並回報」完成結單：'
                    : '👍 已收到「客上」回報！系統已發送感謝搭乘與安全叮嚀給乘客。\n\n因本單乘客未提供詳細下車地址，請於抵達下車時點選下方「填寫訂單金額並回報」（金額為必填）完成結單：',
              },
              boardedFareFlex,
            ],
          });
          continue;
        }

        // 5.5 司機回報「乘客下車 / 確認金額並回報」：抵達目的地，正式結單並回報至群組
        if (
          text === '乘客下車' ||
          text === '下車' ||
          text === '已下車' ||
          text === '結單' ||
          text === '下客' ||
          text === '確認金額並回報'
        ) {
          if (!senderUserId) continue;

          // 需求：司機回報全面改在 1:1 OA 進行，群組內發送則提醒前往 1:1 OA
          if (event.source.type === 'group' || event.source.type === 'room') {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 為維護群組秩序，行程進度回報（到達、客上、乘客下車）請至「1:1 官方帳號」進行！\n👉 請點擊前往 1:1 OA：${env.OFFICIAL_ACCOUNT_URL || 'https://line.me/R/ti/p/@688muuaw'}`,
                },
              ],
            });
            continue;
          }

          const activeOrder = await getActiveOrderByDriverId(senderUserId);

          if (!activeOrder) {
            console.log(`[Trip Completed] 司機 ${senderUserId} 回報「乘客下車」，但無進行中之訂單`);
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 查無您目前進行中的接單行程。' }],
            });
            continue;
          }

          console.log(`[Trip Completed] 司機 ${senderUserId} 回報行程結束結單！訂單: ${activeOrder.id}, 乘客: ${activeOrder.customer_id}`);

          const finalFare = getOrderDefaultFare(activeOrder);
          if (finalFare === null || finalFare <= 0) {
            const requiredFareCard = createDriverBoardedFareConfirmFlexMessage({
              orderId: activeOrder.id,
              pickupAddress: activeOrder.pickup_address,
              dropoffAddress: activeOrder.dropoff_address,
              passengerCount: activeOrder.passenger_count || 1,
              fare: null,
            });
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '⚠️ 此筆訂單乘客未提供詳細下車地址，回報下車時「填寫金額」這一欄為必填！請點擊下方按鈕填寫實際車資金額並完成結單回報：',
                },
                requiredFareCard,
              ],
            });
            continue;
          }

          // 更新訂單狀態為 done (正式結單) 並儲存金額
          const completedOrder = (await completeOrderWithFare(activeOrder.id, finalFare)) || activeOrder;
          if (activeOrder.customer_id && getCustomerChatOrderId(activeOrder.customer_id) === activeOrder.id) {
            endCustomerChatSession(activeOrder.customer_id);
          }

          const driverProfile = await getDriverById(senderUserId);
          const driverName = driverProfile?.display_name || '司機夥伴';

          // 偵測上車地點與下車地點距離，若小於 5 公里即算短程單
          const shortTripEval = await evaluateShortTripOnCompletion({
            order: completedOrder,
          });

          // 1. 傳送到司機群組 (chatroom)：這筆訂單已完結，金額要顯示
          const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
          if (targetGroupId) {
            try {
              const groupCompletedFlex = createGroupOrderCompletedFlexMessage({
                orderId: activeOrder.id,
                driverName,
                pickupAddress: activeOrder.pickup_address,
                dropoffAddress: activeOrder.dropoff_address,
                fare: finalFare,
                isAdjusted: false,
              });
              await lineClient.pushMessage({
                to: targetGroupId,
                messages: [groupCompletedFlex],
              });
              console.log(`[Trip Completed] ✅ 成功向司機群組推播訂單 #${activeOrder.id.slice(-4)} 完結與金額 $${finalFare}`);
            } catch (gErr: any) {
              console.warn('[Trip Completed] 推播司機群組結單失敗:', gErr.message);
            }
          }

          // 2. 1:1 回覆司機結單確認（依需求，結單金額回報無須推播客人的 1:1 OA；若為短程單，附上短程單提示 Flex Message 並發送管理群組核實 Flex Message）
          const replyMessages: messagingApi.Message[] = [
            {
              type: 'text',
              text: `🎉【本次行程已圓滿結單】\n\n🟢 上車：${activeOrder.pickup_address}\n🔴 下車：${activeOrder.dropoff_address || '乘客指定地點'}\n💰 本趟車資：$${finalFare}\n\n已同步將訂單完結與金額回報至聊天室群組！辛苦司機夥伴了！祝您行車平安、接單順利！🚖`,
            },
          ];

          if (shortTripEval.isShortTrip && shortTripEval.dropoffAddress && shortTripEval.distanceKm !== null) {
            const { driverFlex } = await notifyShortTripForVerification({
              order: completedOrder,
              driverId: senderUserId,
              driverName,
              dropoffAddress: shortTripEval.dropoffAddress,
              distanceKm: shortTripEval.distanceKm,
              fare: finalFare,
              pushToDriver: false,
            });
            replyMessages.push(driverFlex);
          }

          await lineClient.replyMessage({
            replyToken,
            messages: replyMessages,
          });
          continue;
        }

        // 5.55 司機輸入「我知道了」確認預約單
        if (text === '我知道了' || text === '收到預約' || text === '確認預約') {
          if (!senderUserId) continue;
          const scheduledOrders = await getScheduledOrdersByDriverId(senderUserId);
          const targetOrder =
            scheduledOrders.find((o) => !hasDriverAck(o)) || scheduledOrders[0];

          if (!targetOrder) {
            await lineClient.replyMessage({
              replyToken,
              messages: [{ type: 'text', text: '⚠️ 目前查無您需要確認的預約單行程。' }],
            });
            continue;
          }

          const ackRes = await acknowledgeReservationOrder(targetOrder.id, senderUserId);
          if (ackRes.success && ackRes.order) {
            const scheduledText = extractScheduledTimeText(ackRes.order);
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `✅【已收到「我知道了」確認】\n您已確認承接預約訂單 #${targetOrder.id.slice(-4)}（預約時間：${scheduledText}）。\n系統將於預約單前 1 小時，在您的 1:1 官方帳號通知您前往上車地點載客（並附完整訂單資訊 Flex Message）！🚖`,
                },
              ],
            });
            checkAndSendReservationReminders().catch(() => {});
          }
          continue;
        }

        // 5.6 司機查詢「目前行程」
        if (text === '目前行程' || text === '當前行程') {
          if (!senderUserId) continue;
          if (event.source.type === 'user') {
            const activeOrder = await getActiveOrderByDriverId(senderUserId);
            if (!activeOrder) {
              await lineClient.replyMessage({
                replyToken,
                messages: [{ type: 'text', text: '🚕 目前沒有進行中的接單行程。' }],
              });
              continue;
            }

            const driver = await getDriverById(senderUserId);
            const orderCard = createDriverOrderCardFlexMessage({
              driverName: driver?.display_name || '司機夥伴',
              orderId: activeOrder.id,
              pickupAddress: activeOrder.pickup_address,
              dropoffAddress: activeOrder.dropoff_address,
              passengerCount: activeOrder.passenger_count || 1,
              etaMinutes: 5,
              scheduledTimeText: activeOrder.note?.replace('預約時間: ', ''),
            });

            await lineClient.replyMessage({
              replyToken,
              messages: [
                { type: 'text', text: `📋 這是您目前進行中的行程任務：` },
                orderCard,
              ],
            });
            continue;
          }
        }

        // 6. 個人 1:1 聊天室指令與叫車處理
        if (event.source.type === 'user') {
          const userSource = event.source as webhook.UserSource;

          // 自動依資料庫身分同步 Rich Menu（司機工作台 vs 乘客選單）
          if (userSource.userId) {
            syncUserRichMenuByRole(userSource.userId).catch(() => {});
          }

          // A. 檢查是否命中「靜默問題/特殊關鍵字」（客訴、退費、遺失物、找客服等）
          const silentCheck = checkSilentQuestion(text);
          if (silentCheck.isSilent) {
            console.log(`🔇 [Silent Question] 乘客訊息命中靜默問題: "${silentCheck.matchedKeyword}" (${silentCheck.category})，保持靜默不回覆。`);
            
            // 若規則設定需通報，推播提醒至幹部群組
            if (silentCheck.notifyAdmin && env.ADMIN_GROUP_ID) {
              let passengerName = '乘客';
              const pUserId = userSource.userId || 'unknown';
              if (userSource.userId) {
                try {
                  const profile = await lineClient.getProfile(userSource.userId);
                  passengerName = profile.displayName;
                } catch {
                  // 忽略個人名稱解析失敗
                }
              }
              const alertFlex = createSilentAlertForAdmin({
                passengerName,
                passengerUserId: pUserId,
                messageText: text,
                matchedKeyword: silentCheck.matchedKeyword || '特殊問題',
                category: silentCheck.category,
              });
              try {
                await lineClient.pushMessage({
                  to: env.ADMIN_GROUP_ID,
                  messages: [alertFlex],
                });
              } catch (alertErr: any) {
                console.warn('[Silent Question] 推播幹部群組失敗:', alertErr.message);
              }
            }
            continue; // 保持靜默，不進行任何機器人自動回覆
          }

          // B. 檢查是否處於「幹部人工接管模式」
          if (await isManualTakeoverActive()) {
            console.log(`🛑 [Manual Takeover] 系統目前由幹部手動接管中，略過機器人自動回覆與派單: "${text}"`);
            continue; // 不由機器人回覆，由真人客服直接透過 LINE OA 後台回覆
          }

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
            text.includes('準時') ||
            text.includes('晚1-5分鐘') ||
            text.includes('晚 1-5 分鐘') ||
            text.includes('正在前往上車點') ||
            text.includes('稍微耽擱')
          ) {
            // ==========================================
            // 需求 1: 乘客按下到點 Quick Reply 按鈕後的簡易回覆 (不觸發預設選單)
            // ==========================================
            console.log(`[Passenger Reply] 乘客 ${userSource.userId} 回覆: "${text}"`);

            // 1. 1:1 OA 立即回覆乘客：「好的，已幫您通知司機，請小心慢行！」
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '好的，已幫您通知司機，請小心慢行！🚖',
                },
              ],
            });

            // 2. 同步將乘客的動態以 Flex Message 轉發至接單司機的 1:1 OA（附前往乘客目的地 Google Maps 導航按鈕，不發到群組）
            try {
              const activeOrder = userSource.userId ? await getActiveOrderByCustomerId(userSource.userId) : null;
              if (activeOrder?.driver_id) {
                const replyBrief = text.includes('準時') ? '【準時前來】正在前往上車點！' : '【稍候片刻】約晚 1-5 分鐘抵達！';
                const passengerReplyFlex = createPassengerArrivalReplyFlexMessage({
                  orderId: activeOrder.id,
                  replyText: replyBrief,
                  pickupAddress: activeOrder.pickup_address,
                  dropoffAddress: activeOrder.dropoff_address,
                  passengerCount: activeOrder.passenger_count,
                });
                passengerReplyFlex.quickReply = {
                  items: [
                    {
                      type: 'action',
                      action: {
                        type: 'message',
                        label: '🚕 客上 (乘客已上車)',
                        text: '客上',
                      },
                    },
                    {
                      type: 'action',
                      action: {
                        type: 'message',
                        label: '🚫 客人未出現',
                        text: '客人未出現',
                      },
                    },
                  ],
                };

                await lineClient.pushMessage({
                  to: activeOrder.driver_id,
                  messages: [passengerReplyFlex],
                });
                console.log(`[Passenger Reply] ✅ 已將乘客回覆以 Flex Message 轉發至司機 1:1 OA (${activeOrder.driver_id})`);
              } else {
                console.log('[Passenger Reply] 未找到接單司機或訂單已結束，無需轉發');
              }
            } catch (fwdErr: any) {
              console.warn('[Passenger Reply] 轉發司機 1:1 OA 失敗:', fwdErr.message);
            }
            continue;
          } else if (
            text === '取消' ||
            text === '取消訂單' ||
            text === '確定取消' ||
            text === '確定取消訂單' ||
            text === '不叫了' ||
            text === '不要了' ||
            text === '不用車了' ||
            text.toLowerCase() === 'cancel' ||
            text.startsWith('取消訂單') ||
            text.startsWith('確定取消')
          ) {
            const customerId = userSource.userId;
            if (!customerId) continue;

            const activeOrders = await getActiveOrdersByCustomerId(customerId);

            if (activeOrders.length === 0) {
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: '⚠️ 您目前沒有進行中的叫車訂單喔！\n若有搭車需求，請隨時輸入「上車地點」與「下車地點」，我們將立即為您派單。😊',
                  },
                ],
              });
              continue;
            }

            // 檢查文字中是否已包含指定單號後碼 (例如 #1234)
            const idMatch = text.match(/#([a-zA-Z0-9_-]+)/);

            // 需求 7: 若同時有兩單以上且使用者只輸入「取消」或「取消訂單」，以 Quick Reply 詢問指的是哪一單
            if (activeOrders.length > 1 && !idMatch) {
              const quickReplyItems: messagingApi.QuickReplyItem[] = activeOrders.map((o) => {
                const isRes = isFutureReservation(o);
                const typeLabel = isRes ? '📅 預約單' : '⚡ 即時單';
                const shortId = o.id.slice(-4);
                return {
                  type: 'action',
                  action: {
                    type: 'message',
                    label: `❌ 取消${typeLabel} #${shortId}`,
                    text: `取消訂單 #${shortId}`,
                  },
                };
              });

              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: `📋 您目前有 ${activeOrders.length} 筆進行中的行程，請問您想要取消哪一筆呢？`,
                    quickReply: { items: quickReplyItems },
                  },
                ],
              });
              continue;
            }

            // 解析目標訂單
            let activeOrder: Order | undefined;
            if (idMatch) {
              const code = idMatch[1].toLowerCase();
              activeOrder = activeOrders.find(
                (o) => o.id.toLowerCase().endsWith(code) || o.id.toLowerCase() === code
              );
            }
            if (!activeOrder && activeOrders.length === 1) {
              activeOrder = activeOrders[0];
            }
            if (!activeOrder) {
              activeOrder = (await getActiveOrderByCustomerId(customerId)) || undefined;
            }

            if (!activeOrder) {
              await lineClient.replyMessage({
                replyToken,
                messages: [{ type: 'text', text: '⚠️ 查無此筆訂單或該訂單已結束。' }],
              });
              continue;
            }

            // 若乘客已經在車上 (客上狀態)，不允許線上直接取消，提醒告知司機安全靠邊
            if (activeOrder.status === 'picked_up') {
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: '⚠️ 您目前已在行程中（客上狀態），無法直接在線上取消。\n若需要提前結束行程或更改目的地，請直接向司機告知，司機將為您於合適地點安全停靠並結單！🚕',
                  },
                ],
              });
              continue;
            }

            // 若尚在 30 秒派單媒合中 (尚未有司機接單)，直接秒速取消
            if (activeOrder.status === 'pending' || activeOrder.status === 'dispatching') {
              await dispatchEngine.cancelDispatch(activeOrder.id);
              await updateOrderStatus(activeOrder.id, 'cancelled');
              if (getCustomerChatOrderId(customerId) === activeOrder.id) {
                endCustomerChatSession(customerId);
              }

              // 1. 回覆乘客確認訊息
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: `✅【叫車已取消】\n您的叫車需求（訂單 #${activeOrder.id.slice(-4)}）已成功取消。\n如需再次用車，歡迎隨時呼叫！✨`,
                  },
                ],
              });
              console.log(`[Cancel Order] 乘客 ${customerId} 成功取消媒合中訂單: ${activeOrder.id}`);

              // 2. 在司機聊天室 / 群組 (chatroom) 也推播該訂單已取消的訊息
              const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
              if (targetGroupId) {
                try {
                  const cancelFlex = createGroupOrderCancelledFlexMessage({
                    orderId: activeOrder.id,
                    pickupAddress: activeOrder.pickup_address,
                    dropoffAddress: activeOrder.dropoff_address || undefined,
                  });
                  await lineClient.pushMessage({
                    to: targetGroupId,
                    messages: [cancelFlex],
                  });
                  console.log(`[Cancel Order] ✅ 成功向司機群組聊天室 ${targetGroupId} 推播訂單取消卡片！`);
                } catch (pushErr: any) {
                  console.error('[Cancel Order] ❌ 推播司機群組聊天室取消卡片失敗:', pushErr);
                }
              }

              continue;
            }

            // 若已有司機接單 (accepted 或 arrived)：
            // 提供二次確認 Quick Reply 防止誤按
            const isConfirmed = text.startsWith('確定取消');
            const shortId = activeOrder.id.slice(-4);
            const isRes = isFutureReservation(activeOrder);
            const typeLabel = isRes ? '📅 預約單' : '⚡ 即時單';

            if (!isConfirmed) {
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: `⚠️ 提醒您：司機夥伴已接下您的${typeLabel}（#${shortId}）！\n📍 上車地點：${activeOrder.pickup_address}\n\n請問您確認要取消此筆訂單嗎？`,
                    quickReply: {
                      items: [
                        {
                          type: 'action',
                          action: {
                            type: 'message',
                            label: `🔴 確定取消 #${shortId}`,
                            text: `確定取消 #${shortId}`,
                          },
                        },
                        {
                          type: 'action',
                          action: {
                            type: 'message',
                            label: '🟢 繼續保留行程',
                            text: '繼續等待司機',
                          },
                        },
                      ],
                    },
                  },
                ],
              });
              continue;
            }

            // 乘客已確認取消司機已接單之訂單
            await updateOrderStatus(activeOrder.id, 'cancelled');
            if (getCustomerChatOrderId(customerId) === activeOrder.id) {
              endCustomerChatSession(customerId);
            }

            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `✅【訂單已取消】\n已為您取消${typeLabel} #${shortId}。\n系統已同步通知接單司機停止前往，感謝您的體諒與配合！`,
                },
              ],
            });

            // 即時推播通知接單司機 1:1 OA，並為司機後台計點 +1 點補單點數
            if (activeOrder.driver_id) {
              const newPoints = await addDriverCompensationPoint(activeOrder.driver_id, 1);
              try {
                await lineClient.pushMessage({
                  to: activeOrder.driver_id,
                  messages: [
                    {
                      type: 'text',
                      text: `📢【訂單取消通知】\n乘客已取消${typeLabel} #${shortId}（上車點：${activeOrder.pickup_address}）。\n\n🎁 系統已自動為您補償 +1 點【補單點數】（目前可用：${newPoints} 點）！\n下次於接單頁面勾選「使用補單點數」，喊單當下即可立即結單中單，不用再等 30 秒規則！辛苦了！🚖`,
                    },
                  ],
                });
                console.log(`[Cancel Order] ✅ 成功推播訂單取消與補單點數通知至司機 1:1 OA: ${activeOrder.driver_id} (目前點數: ${newPoints})`);
              } catch (pushErr: any) {
                console.warn('[Cancel Order] 推播司機失敗:', pushErr.message);
              }
            }
            continue;
          } else if (text === '繼續等待司機' || text.includes('繼續等待') || text.includes('保留行程')) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '好的！司機夥伴正在全力為您準備與前往上車地點，感謝您的耐心等候！🚖✨',
                },
              ],
            });
            continue;
          } else if (
            text.includes('與司機溝通') ||
            text.includes('聯絡司機') ||
            text.includes('聯繫司機') ||
            text === '溝通'
          ) {
            // ==========================================
            // 需求 5 & 7: 乘客開啟「與司機溝通」雙向傳訊功能
            // ==========================================
            const customerId = userSource.userId;
            if (!customerId) continue;

            const commResult = await resolveOrderForCommunication(customerId, text);

            if (commResult.noOrders) {
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: '⚠️ 您目前沒有進行中的叫車訂單喔！\n若有搭車需求，請隨時輸入上車地點與下車地點叫車。😊',
                  },
                ],
              });
              continue;
            }

            if (commResult.pendingOnly) {
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: '⏳ 您的訂單目前正在為您尋找司機中，待司機接單後即可透過 1:1 官方帳號與司機直接對話！',
                  },
                ],
              });
              continue;
            }

            if (commResult.needsDisambiguation) {
              // 需求 7: 多單時以 Quick Reply 詢問指哪一單
              const quickReplyItems: messagingApi.QuickReplyItem[] = commResult.ordersWithDriver.map((o) => {
                const isRes = isFutureReservation(o);
                const typeLabel = isRes ? '📅 預約' : '⚡ 即時';
                const shortId = o.id.slice(-4);
                return {
                  type: 'action',
                  action: {
                    type: 'message',
                    label: `💬 溝通${typeLabel} #${shortId}`,
                    text: `與司機溝通 #${shortId}`,
                  },
                };
              });

              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: `💬 您目前有多筆已有司機接單的行程，請問您想與哪一位司機溝通呢？`,
                    quickReply: { items: quickReplyItems },
                  },
                ],
              });
              continue;
            }

            if (commResult.targetOrder) {
              const target = commResult.targetOrder;
              startCustomerChatSession(customerId, target.id);
              const isRes = isFutureReservation(target);
              const typeLabel = isRes ? '📅 預約單' : '⚡ 即時單';
              const shortId = target.id.slice(-4);

              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: `💬【已開啟與司機溝通】\n已為您接通${typeLabel}（#${shortId}）之接單司機！\n📍 上車地點：${target.pickup_address}\n\n您接下來在此輸入的文字訊息，系統將會即時轉發給司機。\n（若需結束對話，請輸入「結束溝通」）`,
                    quickReply: {
                      items: [
                        {
                          type: 'action',
                          action: {
                            type: 'message',
                            label: '❌ 結束溝通',
                            text: '結束溝通',
                          },
                        },
                      ],
                    },
                  },
                ],
              });
              continue;
            }
          } else if (
            text === '我的預約' ||
            text === '查詢預約' ||
            text === '預約查詢' ||
            text === '查看預約' ||
            text === '預約狀態'
          ) {
            const customerId = userSource.userId;
            if (!customerId) continue;

            const reservationOrders = await getActiveReservationOrdersByCustomerId(customerId);
            if (reservationOrders.length === 0) {
              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: '📅 您目前沒有正在進行中的預約單喔！\n如需預約用車，請點選下方選單或輸入上車地點、下車地點與預約乘車時間。😊',
                  },
                ],
              });
              continue;
            }

            const statusItems: CustomerReservationStatusItem[] = [];
            for (const rOrder of reservationOrders) {
              const isAccepted = Boolean(
                rOrder.driver_id &&
                ['accepted', 'arrived', 'in_progress', 'picked_up'].includes(rOrder.status)
              );
              const driver = isAccepted && rOrder.driver_id
                ? await getDriverById(rOrder.driver_id)
                : null;

              statusItems.push({
                orderId: rOrder.id,
                scheduledTimeText: extractScheduledTimeText(rOrder),
                pickupAddress: rOrder.pickup_address,
                dropoffAddress: rOrder.dropoff_address,
                passengerCount: rOrder.passenger_count || 1,
                estimatedFare: rOrder.fare ? Number(rOrder.fare) : null,
                status: rOrder.status,
                isAccepted,
                driverAcknowledged: hasDriverAck(rOrder),
                driverName: driver?.display_name || (isAccepted ? '優質司機' : null),
                carBrand: driver?.car_brand || null,
                plateNumber: driver?.plate_number || null,
                carColor: driver?.car_color || null,
              });
            }

            const statusFlex = createCustomerReservationStatusFlexMessage(statusItems);
            await lineClient.replyMessage({
              replyToken,
              messages: [statusFlex],
            });
            continue;
          } else if (
            text === '結束溝通' || text === '結束對話' || text === '停止溝通'
          ) {
            const customerId = userSource.userId;
            if (customerId) endCustomerChatSession(customerId);
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '💬 已為您結束與司機的溝通對話。祝您乘車愉快！✨',
                },
              ],
            });
            continue;
          } else if (
            (text.includes('上車') || text.includes('1.')) &&
            (text.includes('下車') || text.includes('2.'))
          ) {
            // ==========================================
            // 乘客送出叫車資訊 (格式解析與派單)
            // ==========================================

            // 萃取上車地點、下車地點、人數、乘車時間
            let pickupAddr = '';
            let dropoffAddr = '';
            let passengerCount: number | undefined = undefined;
            let scheduledTimeText: string | undefined = undefined;

            const lines = text.split('\n');
            for (const line of lines) {
              const cleaned = line.trim();
              if (cleaned.includes('上車地點') || cleaned.includes('上車：') || cleaned.includes('上車:')) {
                pickupAddr = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[上車地點]+[\s：:]*/, '').trim();
              } else if (cleaned.includes('下車地點') || cleaned.includes('下車：') || cleaned.includes('下車:')) {
                dropoffAddr = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[下車地點]+[\s：:]*/, '').trim();
              } else if (cleaned.includes('人數') && !cleaned.includes('乘車時間')) {
                const countStr = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[人數]+[\s：:]*/, '').trim();
                const match = countStr.match(/\d+/);
                if (match) passengerCount = parseInt(match[0], 10);
              } else if (cleaned.includes('乘車時間')) {
                const timeStr = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[乘車時間]+[\s：:]*/, '').trim();
                if (timeStr && !timeStr.includes('現在要車免填') && timeStr !== '免填') {
                  scheduledTimeText = timeStr;
                }
              } else if (cleaned.includes('乘車時間與人數')) {
                const oldStr = cleaned.replace(/^[0-9一二三四五六七八九十\.\s]*[乘車時間與人數]+[\s：:]*/, '').trim();
                const match = oldStr.match(/\d+/);
                if (match) passengerCount = parseInt(match[0], 10);
                if (oldStr.includes('分') || oldStr.includes('點') || oldStr.includes(':')) {
                  scheduledTimeText = oldStr;
                }
              }
            }

            // 需求 1: 這四個資訊中必填的只有 1.上車地點。
            // 如果沒填卻送出的話，1:1 OA 回覆請至少要填寫上車地點，並再次帶入空白的 [1-4] 點乘車資訊到輸入框中。
            if (!pickupAddr) {
              console.log(`[Line Webhook] 乘客 ${userSource.userId} 未填寫上車地點，提示補填並帶入空白範本`);
              const blankRideFillIn = `1. 上車地點：
2. 下車地點：
3. 人數：
4. 乘車時間：`;

              await lineClient.replyMessage({
                replyToken,
                messages: [
                  {
                    type: 'text',
                    text: '⚠️ 請至少填寫【1. 上車地點】才能為您安排車輛喔！請點選下方按鈕重新帶入格式填寫：',
                    quickReply: {
                      items: [
                        {
                          type: 'action',
                          action: {
                            type: 'postback',
                            label: '📝 填寫上車地點',
                            data: 'action=service_select&service=city_ride',
                            displayText: '填寫叫車資訊',
                            inputOption: 'openKeyboard',
                            fillInText: blankRideFillIn,
                          },
                        },
                      ],
                    },
                  },
                ],
              });
              continue;
            }

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
                // 確保 customer 存在
                const customerId = userSource.userId;
                try {
                  if (customerId && env.DATABASE_URL) {
                    await query(
                      `INSERT INTO customers (line_user_id, display_name) VALUES ($1, 'LINE 乘客') ON CONFLICT (line_user_id) DO NOTHING;`,
                      [customerId]
                    );
                  }
                } catch (cErr: any) {
                  console.warn('[Line Webhook] Customer upsert warning:', cErr.message);
                }

                // 呼叫 Google Geocoding 取得上車點經緯度
                const pickupGeo = await geocodeAddress(pickupAddr);

                // 需求 1: 常客固定上下車地點與固定金額判斷
                // 若上下車地點皆與常客設定相符，使用固定金額與固定路線；若有任一不符合，則以正常費率計算
                const matchedRegular = await matchRegularCustomerRoute({
                  customerId,
                  pickupAddress: pickupAddr,
                  dropoffAddress: dropoffAddr,
                });

                const hasDetailedDropoff = isDetailedDropoffAddress(dropoffAddr);
                let fareResult: any = undefined;
                let dropoffGeo: any = null;
                let fixedRoute: string | null = null;

                if (matchedRegular) {
                  if (dropoffAddr) {
                    dropoffGeo = await geocodeAddress(dropoffAddr).catch(() => null);
                  }
                  fixedRoute = matchedRegular.fixed_route || null;
                  fareResult = {
                    estimatedFare: matchedRegular.fixed_fare,
                    distanceKm: 0,
                    fareBreakdown: fixedRoute
                      ? `常客固定金額｜固定路線：${fixedRoute}`
                      : '常客固定金額',
                  };
                  console.log(
                    `[Line Webhook] 🌟 命中常客固定路線 (${matchedRegular.customer_name}): 固定車資 $${matchedRegular.fixed_fare}, 固定路線: ${fixedRoute || '無'}`
                  );
                } else if (hasDetailedDropoff) {
                  dropoffGeo = await geocodeAddress(dropoffAddr);
                  fareResult = calculateFare(
                    'city',
                    pickupGeo.lat, pickupGeo.lng,
                    dropoffGeo.lat, dropoffGeo.lng
                  );
                  console.log(`[Line Webhook] 預估車資(正常費率): $${fareResult.estimatedFare} (${fareResult.distanceKm}km, ${fareResult.fareBreakdown})`);
                } else {
                  console.log('[Line Webhook] 乘客未提供詳細下車地址，接單不顯示金額，待司機回報下車時必填');
                }

                // 解析乘車時間是否為未來預約單 (> 1小時)
                const parsedReservation = parseScheduledTimeString(scheduledTimeText);
                const scheduledDate = parsedReservation?.date || null;
                const isReservation = Boolean(parsedReservation?.isReservation);
                const effectiveScheduledText = parsedReservation?.formattedText || scheduledTimeText;

                // 建立訂單 (status: pending)
                const newOrder = await createOrder({
                  customer_id: customerId || 'UNKNOWN_CUSTOMER',
                  service_type: 'city',
                  pickup_address: pickupAddr,
                  pickup_lat: pickupGeo.lat,
                  pickup_lng: pickupGeo.lng,
                  dropoff_address: dropoffAddr || undefined,
                  dropoff_lat: dropoffGeo ? dropoffGeo.lat : undefined,
                  dropoff_lng: dropoffGeo ? dropoffGeo.lng : undefined,
                  passenger_count: passengerCount || 1,
                  scheduled_time: scheduledDate,
                  distance_km: fareResult && fareResult.distanceKm ? fareResult.distanceKm : undefined,
                  fare: fareResult ? fareResult.estimatedFare : undefined,
                  fixed_route: fixedRoute || undefined,
                  note: effectiveScheduledText ? `預約時間: ${effectiveScheduledText}` : undefined,
                });

                console.log(`[Line Webhook] 訂單 ${newOrder.id} 建立成功！(預約單: ${isReservation})`);

                // 司機接單 LIFF 網址
                const bidUrl = env.LIFF_ID
                  ? `https://liff.line.me/${env.LIFF_ID}/driver/bid?orderId=${newOrder.id}`
                  : `https://flow-taxi-production.up.railway.app/driver/bid?orderId=${newOrder.id}`;

                // 需求 3: 回報為短距離單 LIFF 網址
                const shortTripUrl = env.LIFF_ID
                  ? `https://liff.line.me/${env.LIFF_ID}/driver/short-trip?orderId=${newOrder.id}`
                  : `https://flow-taxi-production.up.railway.app/driver/short-trip?orderId=${newOrder.id}`;

                // 預約單出現邏輯：
                // - 若距離上車時間 > 10 小時，暫不在聊天室跳出 Flex Message，待上車前 10 小時由排程自動跳出（並每 30 分鐘重跳一次）
                // - 若距離上車時間 <= 10 小時（或一般即時單），立即在聊天室跳出 Flex Message 並啟動 30 秒接單視窗
                const reservationAction = isReservation
                  ? evaluateReservationDispatchAction(newOrder)
                  : 'immediate';

                if (isReservation && reservationAction === 'wait_for_10h') {
                  console.log(
                    `[Line Webhook] 📅 預約單 ${newOrder.id} 距離上車時間 (${effectiveScheduledText}) 超過 10 小時，已排入系統排程，將於上車前 10 小時自動在聊天室跳出派單 Flex Message！`
                  );
                } else {
                  if (isReservation) {
                    await markReservationBroadcasted(newOrder.id);
                  }

                  // 1. 向司機群組廣播 Flex Message
                  const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
                  if (targetGroupId) {
                    const dispatchFlex = createGroupDispatchOrderFlexMessage({
                      orderId: newOrder.id,
                      pickupAddress: pickupAddr,
                      dropoffAddress: dropoffAddr || undefined,
                      passengerCount: passengerCount || 1,
                      scheduledTimeText: effectiveScheduledText,
                      isReservation: isReservation,
                      estimatedFare: fareResult ? fareResult.estimatedFare : undefined,
                      fareBreakdown: fareResult ? fareResult.fareBreakdown : undefined,
                      distanceKm: fareResult ? fareResult.distanceKm : undefined,
                      fixedRoute: fixedRoute || extractFixedRoute(newOrder),
                      bidUrl,
                      shortTripUrl: !dropoffAddr ? shortTripUrl : undefined,
                    });

                    await lineClient.pushMessage({
                      to: targetGroupId,
                      messages: [dispatchFlex],
                    });
                    console.log(`[Line Webhook] 成功向司機群組 ${targetGroupId} 廣播派單卡片！`);
                  }

                  // 2. 啟動派單收集視窗 (30 秒)
                  await dispatchEngine.startDispatch(newOrder.id, 30);
                }
              } catch (dispatchErr: any) {
                console.error('[Line Webhook] 派單建立廣播失敗:', dispatchErr);
              }
            })();
          } else if (
            text === '叫車' ||
            text === '預約叫車' ||
            text === '服務項目' ||
            text === '我要叫車' ||
            text === '開始叫車' ||
            text === '選單' ||
            text === '服務選單'
          ) {
            // 圖文選單點擊呼叫：發送完整服務說明與 6 大服務 Quick Reply 膠囊按鈕
            await lineClient.replyMessage({
              replyToken,
              messages: [createWelcomeServiceMessage()],
            });
            continue;
          } else if (text.includes('市區搭乘')) {
            // 輸入「市區搭乘」時的回覆
            await lineClient.replyMessage({
              replyToken,
              messages: [createCityRidePromptMessage()],
            });
          } else if (text.includes('機場預約') || text.includes('機場接送') || text.includes('機場')) {
            // 輸入「機場預約 / 機場接送」時的回覆
            await lineClient.replyMessage({
              replyToken,
              messages: [createAirportRidePromptMessage()],
            });
          } else if (text.includes('酒後代駕')) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: `您選擇了【${text}】服務 🚕\n💰 計費說明：10公里700元，超過1公里，每公里50元。\n\n請直接輸入您的：\n1. 上車地點\n2. 下車地點\n3. 乘車時間與人數\n\n派單專員將立即為您安排優質司機！`,
                },
              ],
            });
          } else if (
            text.includes('代購代送') ||
            text.includes('包車服務')
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
            const currentUserId = userSource.userId;

            // 1. 檢查是否為已有活躍接單的司機（優先判定：若司機於 1:1 OA 輸入文字，自動轉發給乘客）
            if (currentUserId) {
              const driver = await getDriverById(currentUserId);
              if (driver && driver.registered) {
                const driverOrder =
                  (await getActiveOrderByDriverId(currentUserId)) ||
                  (await getScheduledOrdersByDriverId(currentUserId))[0];
                if (driverOrder && driverOrder.customer_id) {
                  const forwarded = await forwardMessageToPassenger(driverOrder, currentUserId, text);
                  if (forwarded) {
                    await lineClient.replyMessage({
                      replyToken,
                      messages: [
                        {
                          type: 'text',
                          text: `✅ 已將您的訊息轉發給乘客！（訂單 #${driverOrder.id.slice(-4)}）`,
                        },
                      ],
                    });
                    continue;
                  }
                }
              }
            }

            // 2. 檢查是否為處於「與司機溝通」會話中，或已有指派司機進行中訂單之乘客
            if (currentUserId) {
              const customerId = currentUserId;
              let chatOrderId = isCustomerInChatSession(customerId)
                ? getCustomerChatOrderId(customerId)
                : undefined;

              // 若乘客未顯式點選「與司機溝通」，但當前已有司機接單之活躍行程，自動綁定溝通並轉發
              if (!chatOrderId) {
                const activeOrder = await getActiveOrderByCustomerId(customerId);
                if (
                  activeOrder &&
                  activeOrder.driver_id &&
                  ['accepted', 'in_progress', 'arrived', 'picked_up'].includes(activeOrder.status)
                ) {
                  chatOrderId = activeOrder.id;
                  startCustomerChatSession(customerId, activeOrder.id);
                }
              }

              if (chatOrderId) {
                const order = await getOrderById(chatOrderId);
                if (
                  order &&
                  order.driver_id &&
                  ['accepted', 'in_progress', 'arrived', 'picked_up'].includes(order.status)
                ) {
                  const forwarded = await forwardMessageToDriver(order, text);
                  if (forwarded) {
                    await lineClient.replyMessage({
                      replyToken,
                      messages: [
                        {
                          type: 'text',
                          text: `✅ 已將您的訊息轉發給司機夥伴！🚖\n\n「${text}」`,
                          quickReply: {
                            items: [
                              {
                                type: 'action',
                                action: {
                                  type: 'message',
                                  label: '❌ 結束溝通',
                                  text: '結束溝通',
                                },
                              },
                            ],
                          },
                        },
                      ],
                    });
                    continue;
                  }
                } else {
                  endCustomerChatSession(customerId);
                }
              }
            }

            // 3. 1:1 聊天室預設回覆：發送完整歡迎詞與 6 大服務 Quick Reply 按鈕
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
