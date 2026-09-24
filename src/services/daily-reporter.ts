import { messagingApi } from '@line/bot-sdk';
import { query } from '../db/index.js';
import { env } from '../config/env.js';
import { getLineClient } from './line-client.js';

export interface DailySummaryStats {
  dateText: string;
  totalOrders: number;
  completedOrders: number;
  noDriverOrders: number;
  cancelledOrders: number;
  matchRatePercent: number;
  estimatedTotalFare: number;
  activeDriversCount: number;
}

/**
 * 聚合今日（或指定日期）營運指標數據
 */
export async function aggregateDailyStats(targetDate: Date = new Date()): Promise<DailySummaryStats> {
  const dateStr = targetDate.toISOString().split('T')[0];
  const dateDisplay = targetDate.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const defaultStats: DailySummaryStats = {
    dateText: dateDisplay,
    totalOrders: 0,
    completedOrders: 0,
    noDriverOrders: 0,
    cancelledOrders: 0,
    matchRatePercent: 0,
    estimatedTotalFare: 0,
    activeDriversCount: 0,
  };

  if (!env.DATABASE_URL) {
    return defaultStats;
  }

  try {
    // 1. 訂單統計
    const ordersRes = await query(
      `
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status IN ('accepted', 'completed') THEN 1 END) as completed_orders,
        COUNT(CASE WHEN status = 'no_driver' THEN 1 END) as no_driver_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        COALESCE(SUM(CASE WHEN status IN ('accepted', 'completed') THEN estimated_fare ELSE 0 END), 0) as total_fare
      FROM orders
      WHERE created_at::date = $1::date;
      `,
      [dateStr]
    );

    const row = ordersRes.rows[0];
    const totalOrders = Number(row?.total_orders || 0);
    const completedOrders = Number(row?.completed_orders || 0);
    const noDriverOrders = Number(row?.no_driver_orders || 0);
    const cancelledOrders = Number(row?.cancelled_orders || 0);
    const estimatedTotalFare = Number(row?.total_fare || 0);
    const matchRatePercent = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

    // 2. 活躍投標司機數
    const driverRes = await query(
      `
      SELECT COUNT(DISTINCT driver_id) as active_drivers
      FROM order_bids
      WHERE created_at::date = $1::date;
      `,
      [dateStr]
    );
    const activeDriversCount = Number(driverRes.rows[0]?.active_drivers || 0);

    return {
      dateText: dateDisplay,
      totalOrders,
      completedOrders,
      noDriverOrders,
      cancelledOrders,
      matchRatePercent,
      estimatedTotalFare,
      activeDriversCount,
    };
  } catch (err: any) {
    console.warn('[Daily Reporter] 統計今日數據失敗，使用預設值:', err.message);
    return defaultStats;
  }
}

/**
 * 產出每日營運戰報 Flex Message 卡片
 */
export function createDailyReportFlexMessage(stats: DailySummaryStats): messagingApi.FlexMessage {
  const container: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0f172a',
      paddingAll: '18px',
      contents: [
        {
          type: 'text',
          text: '📊【每日營運戰報】',
          color: '#38bdf8',
          weight: 'bold',
          size: 'lg',
        },
        {
          type: 'text',
          text: `結算日期：${stats.dateText}`,
          color: '#94a3b8',
          size: 'xs',
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
        // 營收與總單量大字指標
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              flex: 5,
              contents: [
                { type: 'text', text: '今日總單量', color: '#64748b', size: 'xs' },
                { type: 'text', text: `${stats.totalOrders} 筆`, color: '#0f172a', size: 'xxl', weight: 'bold' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 5,
              contents: [
                { type: 'text', text: '估算營業總額', color: '#64748b', size: 'xs' },
                { type: 'text', text: `$${stats.estimatedTotalFare}`, color: '#16a34a', size: 'xxl', weight: 'bold' },
              ],
            },
          ],
        },
        {
          type: 'separator',
          color: '#f1f5f9',
          margin: 'md',
        },
        // 細項指標清單
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '✅ 成功媒合：', color: '#64748b', size: 'sm', flex: 4 },
                { type: 'text', text: `${stats.completedOrders} 筆 (媒合率 ${stats.matchRatePercent}%)`, color: '#0284c7', size: 'sm', weight: 'bold', flex: 6 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '⚠️ 流單(無司機)：', color: '#64748b', size: 'sm', flex: 4 },
                { type: 'text', text: `${stats.noDriverOrders} 筆`, color: '#eab308', size: 'sm', weight: 'bold', flex: 6 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '❌ 乘客取消：', color: '#64748b', size: 'sm', flex: 4 },
                { type: 'text', text: `${stats.cancelledOrders} 筆`, color: '#ef4444', size: 'sm', weight: 'bold', flex: 6 },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '🚕 今日活躍司機：', color: '#64748b', size: 'sm', flex: 4 },
                { type: 'text', text: `${stats.activeDriversCount} 位`, color: '#6366f1', size: 'sm', weight: 'bold', flex: 6 },
              ],
            },
          ],
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
          text: '此報表由派單系統於設定時段自動彙整推播。祝營運順心！',
          color: '#94a3b8',
          size: 'xxs',
          align: 'center',
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `📊【每日營運戰報】今日總單量 ${stats.totalOrders} 筆，成功媒合率 ${stats.matchRatePercent}%`,
    contents: container,
  };
}

/**
 * 主動發送每日營運報表至幹部群組
 */
export async function sendDailyReportToAdmin(targetDate?: Date): Promise<boolean> {
  const adminGroupId = env.ADMIN_GROUP_ID;
  if (!adminGroupId) {
    console.warn('[Daily Reporter] 尚未設定 ADMIN_GROUP_ID，跳過推播每日報表');
    return false;
  }

  try {
    const stats = await aggregateDailyStats(targetDate);
    const flexMessage = createDailyReportFlexMessage(stats);
    const lineClient = getLineClient();

    await lineClient.pushMessage({
      to: adminGroupId,
      messages: [flexMessage],
    });

    console.log(`[Daily Reporter] ✅ 成功向幹部群組 ${adminGroupId} 推播每日營運戰報！`);
    return true;
  } catch (err: any) {
    console.error('[Daily Reporter] 推播每日營運報表失敗:', err.message);
    return false;
  }
}

/**
 * 初始化每日定時排程（定時檢查觸發時間）
 */
let scheduleTimer: NodeJS.Timeout | null = null;
let lastTriggeredDate: string = '';

export function initDailyReportScheduler(): void {
  if (scheduleTimer) return;

  const targetTime = env.DAILY_REPORT_TIME || '23:00';
  console.log(`[Daily Reporter] 📅 每日營運日報排程器已啟動，目標推播時間: 每日 ${targetTime}`);

  // 每 30 秒檢查一次是否到達設定時間
  scheduleTimer = setInterval(async () => {
    const now = new Date();
    const currentHourMin = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const currentDate = now.toISOString().split('T')[0];

    if (currentHourMin === targetTime && lastTriggeredDate !== currentDate) {
      lastTriggeredDate = currentDate;
      console.log(`[Daily Reporter] ⏰ 到達設定時間 ${targetTime}，開始彙整並發送今日營運日報...`);
      await sendDailyReportToAdmin(now);
    }
  }, 30000);
}
