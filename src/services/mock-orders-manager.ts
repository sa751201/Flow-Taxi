import { query } from '../db/index.js';
import { memoryOrders, Order } from '../db/queries/orders.js';
import { env } from '../config/env.js';

export const MOCK_ORDER_TAG = '[MOCK_SIMULATION_20261112]';
export const MOCK_EXPIRATION_TIME = new Date('2026-11-12T19:00:00+08:00');

export interface MockOrderDefinition {
  id: string;
  customer_id: string;
  service_type: 'city' | 'airport' | 'charter';
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string | null;
  dropoff_lat?: number;
  dropoff_lng?: number;
  passenger_count: number;
  distance_km: number | null;
  fare: number | null;
  scheduled_time: Date | null;
  note: string;
}

export const MOCK_ORDERS_DATA: MockOrderDefinition[] = [
  // 1. 即時單：台北車站 ➔ 國立故宮博物院
  {
    id: 'mock-261112-01',
    customer_id: 'mock_cust_01',
    service_type: 'city',
    pickup_address: '台北車站 (東三門出口)',
    pickup_lat: 25.0478,
    pickup_lng: 121.5170,
    dropoff_address: '國立故宮博物院 (士林區至善路二段221號)',
    dropoff_lat: 25.1024,
    dropoff_lng: 121.5485,
    passenger_count: 2,
    distance_km: 8.5,
    fare: 310,
    scheduled_time: null,
    note: `⚡ 即時 · 乘客已在大廳門口等候 · 無大行李 ${MOCK_ORDER_TAG}`,
  },
  // 2. 即時單：台北101 ➔ 松山機場 (趕班機)
  {
    id: 'mock-261112-02',
    customer_id: 'mock_cust_02',
    service_type: 'city',
    pickup_address: '台北101 (信義區信義路五段7號大門)',
    pickup_lat: 25.0339,
    pickup_lng: 121.5644,
    dropoff_address: '台北松山機場 第一航廈 (國際線出發層)',
    dropoff_lat: 25.0697,
    dropoff_lng: 121.5524,
    passenger_count: 1,
    distance_km: 5.2,
    fare: 230,
    scheduled_time: null,
    note: `⚡ 即時 · 趕班機中 · 需後車廂放 1 只 26 吋行李箱 ${MOCK_ORDER_TAG}`,
  },
  // 3. 即時單：內湖高中 ➔ 台北車站
  {
    id: 'mock-261112-03',
    customer_id: 'mock_cust_03',
    service_type: 'city',
    pickup_address: '內湖高中 (內湖路二段314號校門口)',
    pickup_lat: 25.0833,
    pickup_lng: 121.5901,
    dropoff_address: '台北車站 (北一門市民大道側)',
    dropoff_lat: 25.0488,
    dropoff_lng: 121.5175,
    passenger_count: 3,
    distance_km: 10.1,
    fare: 360,
    scheduled_time: null,
    note: `⚡ 即時 · 門口招手等候中 · 全車禁菸 ${MOCK_ORDER_TAG}`,
  },
  // 4. 即時單：南港展覽館 ➔ 圓山大飯店
  {
    id: 'mock-261112-04',
    customer_id: 'mock_cust_04',
    service_type: 'city',
    pickup_address: '南港展覽館 1館 (經貿二路1號迎賓車道)',
    pickup_lat: 25.0569,
    pickup_lng: 121.6172,
    dropoff_address: '圓山大飯店 (中山區中山北路四段1號)',
    dropoff_lat: 25.0792,
    dropoff_lng: 121.5262,
    passenger_count: 2,
    distance_km: 11.8,
    fare: 410,
    scheduled_time: null,
    note: `⚡ 即時 · 參展廠商商務接送 · 需開立電子發票證明聯 ${MOCK_ORDER_TAG}`,
  },
  // 5. 即時單：板橋車站 ➔ 西門町
  {
    id: 'mock-261112-05',
    customer_id: 'mock_cust_05',
    service_type: 'city',
    pickup_address: '板橋車站 (新北市板橋區縣民大道二段7號北門)',
    pickup_lat: 25.0142,
    pickup_lng: 121.4637,
    dropoff_address: '西門町 (捷運西門站 6號出口旁)',
    dropoff_lat: 25.0422,
    dropoff_lng: 121.5080,
    passenger_count: 4,
    distance_km: 6.8,
    fare: 260,
    scheduled_time: null,
    note: `⚡ 即時 · 4位乘客 · 西門町逛街聚會 ${MOCK_ORDER_TAG}`,
  },
  // 6. 即時單：華山1914文創園區 (未填目的地，上車說明)
  {
    id: 'mock-261112-06',
    customer_id: 'mock_cust_06',
    service_type: 'city',
    pickup_address: '華山1914文創園區 (中正區八德路一段1號大門)',
    pickup_lat: 25.0441,
    pickup_lng: 121.5294,
    dropoff_address: null,
    passenger_count: 1,
    distance_km: null,
    fare: null,
    scheduled_time: null,
    note: `⚡ 即時 · 臨時出發，上車再告知司機精確目的地 ${MOCK_ORDER_TAG}`,
  },
  // 7. 預約單：晶華酒店 ➔ 桃園國際機場 (長途高車資預約)
  {
    id: 'mock-261112-07',
    customer_id: 'mock_cust_07',
    service_type: 'airport',
    pickup_address: '台北晶華酒店 (中山北路二段39巷3號迎賓門)',
    pickup_lat: 25.0537,
    pickup_lng: 121.5245,
    dropoff_address: '桃園國際機場 第二航廈 (出境大廳3樓門口)',
    dropoff_lat: 25.0797,
    dropoff_lng: 121.2342,
    passenger_count: 2,
    distance_km: 42.0,
    fare: 1350,
    scheduled_time: new Date('2026-11-12T14:00:00+08:00'),
    note: `📅 預約: 2026/11/12 14:00 出發 · 2只29吋大行李 · 請協助後車廂搬運 ${MOCK_ORDER_TAG}`,
  },
  // 8. 預約單：長庚科技大學 ➔ 桃園火車站
  {
    id: 'mock-261112-08',
    customer_id: 'mock_cust_08',
    service_type: 'city',
    pickup_address: '長庚科技大學 (桃園市龜山區文化一路261號正門口)',
    pickup_lat: 25.0345,
    pickup_lng: 121.3912,
    dropoff_address: '桃園火車站 (前站中正路出口)',
    dropoff_lat: 24.9892,
    dropoff_lng: 121.3135,
    passenger_count: 1,
    distance_km: 11.2,
    fare: 390,
    scheduled_time: new Date('2026-11-12T15:30:00+08:00'),
    note: `📅 預約: 2026/11/12 15:30 下課返家 · 準時於校門口上車 ${MOCK_ORDER_TAG}`,
  },
  // 9. 預約單：中壢仁海宮 ➔ 桃園高鐵站
  {
    id: 'mock-261112-09',
    customer_id: 'mock_cust_09',
    service_type: 'city',
    pickup_address: '中壢仁海宮 (桃園市中壢區延平路198號牌樓前)',
    pickup_lat: 24.9622,
    pickup_lng: 121.2335,
    dropoff_address: '高鐵桃園站 (桃園市中壢區高鐵北路一段6號7號出口)',
    dropoff_lat: 25.0125,
    dropoff_lng: 121.2148,
    passenger_count: 3,
    distance_km: 8.3,
    fare: 300,
    scheduled_time: new Date('2026-11-12T17:00:00+08:00'),
    note: `📅 預約: 2026/11/12 17:00 參拜返程 · 需於 17:20 前抵達高鐵站搭車 ${MOCK_ORDER_TAG}`,
  },
  // 10. 預約單：松菸文創園區 ➔ 陽明山美軍俱樂部 (傍晚寵物友善約會)
  {
    id: 'mock-261112-10',
    customer_id: 'mock_cust_10',
    service_type: 'city',
    pickup_address: '誠品生活松菸 (台北市信義區菸廠路88號大門)',
    pickup_lat: 25.0445,
    pickup_lng: 121.5606,
    dropoff_address: '陽明山 美軍俱樂部 (士林區凱旋路49號)',
    dropoff_lat: 25.1378,
    dropoff_lng: 121.5456,
    passenger_count: 2,
    distance_km: 15.6,
    fare: 580,
    scheduled_time: new Date('2026-11-12T18:30:00+08:00'),
    note: `📅 預約: 2026/11/12 18:30 晚餐約會 · 攜帶小型寵物柴犬（已有外出推車籠） ${MOCK_ORDER_TAG}`,
  },
];

/**
 * 檢查目前時間是否已超過今晚 7 點移除門檻
 */
export function isMockOrderExpired(): boolean {
  return new Date() >= MOCK_EXPIRATION_TIME;
}

/**
 * 初始化並注入 10 筆真實情境模擬訂單至 DB 與記憶體
 */
export async function seedMockOrders(): Promise<void> {
  if (isMockOrderExpired()) {
    console.log('[Mock Manager] 已過今晚 7 點，跳過模擬單初始化。');
    return;
  }

  console.log('[Mock Manager] 正在注入 10 筆情境模擬訂單 (6 即時 / 4 預約)...');

  // 1. 同步寫入記憶體快取 (確保即便無 DB 也能在網頁端正常運作)
  for (const ord of MOCK_ORDERS_DATA) {
    const memoryObj: Order = {
      id: ord.id,
      customer_id: ord.customer_id,
      service_type: ord.service_type,
      pickup_address: ord.pickup_address,
      pickup_lat: ord.pickup_lat,
      pickup_lng: ord.pickup_lng,
      dropoff_address: ord.dropoff_address || undefined,
      dropoff_lat: ord.dropoff_lat,
      dropoff_lng: ord.dropoff_lng,
      passenger_count: ord.passenger_count,
      distance_km: ord.distance_km || undefined,
      fare: ord.fare || undefined,
      scheduled_time: ord.scheduled_time,
      note: ord.note,
      status: 'dispatching',
      created_at: new Date(),
    };
    memoryOrders.set(ord.id, memoryObj);
  }

  // 2. 若有 DATABASE_URL，寫入 PostgreSQL 資料庫
  if (env.DATABASE_URL) {
    try {
      await query("DELETE FROM orders WHERE note LIKE '%[MOCK_SIMULATION_20261112]%' OR id LIKE 'mock-261112-%';");

      for (const ord of MOCK_ORDERS_DATA) {
        const sql = `
          INSERT INTO orders (
            id,
            customer_id,
            service_type,
            pickup_address,
            pickup_geog,
            dropoff_address,
            dropoff_geog,
            passenger_count,
            distance_km,
            fare,
            scheduled_time,
            note,
            status,
            created_at
          ) VALUES (
            $1, $2, $3, $4,
            ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
            $7,
            ${ord.dropoff_lat && ord.dropoff_lng ? `ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography` : 'NULL'},
            $10, $11, $12, $13, $14,
            'dispatching',
            NOW()
          );
        `;
        const values = [
          ord.id,
          ord.customer_id,
          ord.service_type,
          ord.pickup_address,
          ord.pickup_lng,
          ord.pickup_lat,
          ord.dropoff_address,
          ...(ord.dropoff_lat && ord.dropoff_lng ? [ord.dropoff_lng, ord.dropoff_lat] : []),
          ord.passenger_count,
          ord.distance_km,
          ord.fare,
          ord.scheduled_time,
          ord.note,
        ];
        await query(sql, values);
      }
      console.log('[Mock Manager] ✅ 10 筆模擬訂單已成功寫入 PostgreSQL！');
    } catch (e: any) {
      console.warn('[Mock Manager] 寫入 PostgreSQL 失敗，使用記憶體備援模式:', e.message);
    }
  }

  console.log('[Mock Manager] ✅ 10 筆模擬訂單載入完成，將於今晚 19:00:00 自動移除。');
}

/**
 * 清除所有模擬訂單 (手動或定時)
 */
export async function purgeMockOrders(force: boolean = false): Promise<number> {
  if (!force && !isMockOrderExpired()) {
    console.log('[Mock Manager] 尚未達今晚 7 點，保留模擬單。若需立即刪除請使用 force=true。');
    return 0;
  }

  let count = 0;
  // 1. 清理記憶體
  for (const [id, ord] of memoryOrders.entries()) {
    if (ord.note?.includes(MOCK_ORDER_TAG) || id.startsWith('mock-261112-')) {
      memoryOrders.delete(id);
      count++;
    }
  }

  // 2. 清理 PostgreSQL
  if (env.DATABASE_URL) {
    try {
      const res = await query(
        "DELETE FROM orders WHERE note LIKE '%[MOCK_SIMULATION_20261112]%' OR id LIKE 'mock-261112-%' RETURNING id;"
      );
      if (res.rowCount) count = Math.max(count, res.rowCount);
    } catch (e: any) {
      console.warn('[Mock Manager] 清理 DB 模擬訂單失敗:', e.message);
    }
  }

  console.log(`[Mock Manager] 🧹 已成功清理 ${count} 筆模擬訂單！`);
  return count;
}

/**
 * 啟動自動排程器：每 5 分鐘檢查一次，一旦超過今晚 19:00 即刻自動刪除
 */
export function startMockOrdersScheduler(): void {
  // 啟動時先載入模擬訂單
  seedMockOrders().catch((e) => console.warn('[Mock Manager] 初始種子載入失敗:', e));

  // 每 2 分鐘檢查是否已達 19:00
  const timer = setInterval(async () => {
    if (isMockOrderExpired()) {
      await purgeMockOrders(true);
      clearInterval(timer);
    }
  }, 2 * 60 * 1000);
}
