/**
 * 計費服務 — 根據派單系統參數表的計費邏輯計算預估車資
 *
 * 計費規則 (config/派單系統參數表.xlsx「計費邏輯」頁籤):
 *
 * ┌──────────┬──────────┬────────┬──────────┬──────────────────────────┬──────────┐
 * │ 服務代碼 │ 服務名稱 │ 基本費 │每公里加價│ 里程規則                  │ 特殊加價 │
 * ├──────────┼──────────┼────────┼──────────┼──────────────────────────┼──────────┤
 * │ city     │ 市區搭乘 │ 60     │ 20       │ 3km 內以 120 元計        │ 上山+100 │
 * │ chauffeur│ 酒後代駕 │ 700    │ 50       │ 10km 內 700，超過每km 50 │ —        │
 * │ airport  │ 機場接送 │ —      │ —        │ 固定價/另議              │ —        │
 * │ 其他     │ 專人報價 │ —      │ —        │ 專人報價                 │ —        │
 * └──────────┴──────────┴────────┴──────────┴──────────────────────────┴──────────┘
 */

// ===================== 可調參數（與 Excel 參數表對應）=====================

/** 市區搭乘計費設定 */
const CITY_FARE = {
  baseFee: 60,         // 基本費 (元)
  perKmRate: 20,       // 每公里加價 (元)
  minFare: 120,        // 3 公里以內最低消費 (元)
  minFareKm: 3,        // 最低消費適用門檻 (公里)
  hillSurcharge: 100,  // 上山加價 (元)
} as const;

/** 酒後代駕計費設定 */
const CHAUFFEUR_FARE = {
  baseFee: 700,        // 基本費 (元) — 10km 內
  perKmRate: 50,       // 超過後每公里加價 (元)
  baseKm: 10,          // 基本費涵蓋里程 (公里)
} as const;

/** 直線距離 → 實際行車距離的路徑修正係數（參數表設定為「直線」計算，乘以係數近似實際路程） */
const STRAIGHT_LINE_MULTIPLIER = 1.3;

// ===================== 型別定義 =====================

export type ServiceType = 'city' | 'chauffeur' | 'airport' | 'purchase' | 'charter' | 'moving';

export interface FareResult {
  /** 預估車資 (元)，若為 null 則需專人報價 */
  estimatedFare: number | null;
  /** 預估距離 (公里) */
  distanceKm: number;
  /** 車資明細說明文字 */
  fareBreakdown: string;
  /** 服務類型 */
  serviceType: ServiceType;
}

// ===================== Haversine 直線距離 =====================

/**
 * 計算兩點間 Haversine 直線距離 (公尺)
 */
export function calculateHaversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371e3; // 地球半徑 (公尺)
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// ===================== 主要計費函式 =====================

/**
 * 根據服務類型與上下車經緯度計算預估車資
 *
 * @param serviceType - 服務代碼 (city / chauffeur / airport / ...)
 * @param pickupLat - 上車點緯度
 * @param pickupLng - 上車點經度
 * @param dropoffLat - 下車點緯度
 * @param dropoffLng - 下車點經度
 * @returns FareResult 計費結果
 */
export function calculateFare(
  serviceType: ServiceType,
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): FareResult {
  // 1. 計算直線距離並乘以路徑修正係數
  const straightMeters = calculateHaversineDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const estimatedMeters = straightMeters * STRAIGHT_LINE_MULTIPLIER;
  const distanceKm = Math.round((estimatedMeters / 1000) * 10) / 10; // 四捨五入到小數一位

  // 2. 依服務類型計費
  switch (serviceType) {
    case 'city':
      return calculateCityFare(distanceKm);

    case 'chauffeur':
      return calculateChauffeurFare(distanceKm);

    case 'airport':
      return {
        estimatedFare: null,
        distanceKm,
        fareBreakdown: '固定價/另議',
        serviceType,
      };

    default:
      // purchase / charter / moving → 專人報價
      return {
        estimatedFare: null,
        distanceKm,
        fareBreakdown: '專人報價',
        serviceType,
      };
  }
}

// ===================== 各服務類型計費邏輯 =====================

/**
 * 市區搭乘計費
 * - 3km 以內：$120
 * - 超過 3km：基本費 $60 + 每公里 $20 × 距離
 */
function calculateCityFare(distanceKm: number): FareResult {
  let fare: number;
  let breakdown: string;

  if (distanceKm <= CITY_FARE.minFareKm) {
    fare = CITY_FARE.minFare;
    breakdown = `${distanceKm}km（${CITY_FARE.minFareKm}km內 $${CITY_FARE.minFare}）`;
  } else {
    fare = CITY_FARE.baseFee + CITY_FARE.perKmRate * distanceKm;
    fare = Math.round(fare); // 四捨五入至整數
    breakdown = `${distanceKm}km × $${CITY_FARE.perKmRate} + 基本費$${CITY_FARE.baseFee}`;
  }

  return {
    estimatedFare: fare,
    distanceKm,
    fareBreakdown: breakdown,
    serviceType: 'city',
  };
}

/**
 * 酒後代駕計費
 * - 10km 以內：$700
 * - 超過 10km：$700 + 每公里 $50 × (距離 - 10)
 */
function calculateChauffeurFare(distanceKm: number): FareResult {
  let fare: number;
  let breakdown: string;

  if (distanceKm <= CHAUFFEUR_FARE.baseKm) {
    fare = CHAUFFEUR_FARE.baseFee;
    breakdown = `${distanceKm}km（${CHAUFFEUR_FARE.baseKm}km內 $${CHAUFFEUR_FARE.baseFee}）`;
  } else {
    const extraKm = distanceKm - CHAUFFEUR_FARE.baseKm;
    fare = CHAUFFEUR_FARE.baseFee + CHAUFFEUR_FARE.perKmRate * extraKm;
    fare = Math.round(fare);
    breakdown = `超出${extraKm.toFixed(1)}km × $${CHAUFFEUR_FARE.perKmRate} + 基本$${CHAUFFEUR_FARE.baseFee}`;
  }

  return {
    estimatedFare: fare,
    distanceKm,
    fareBreakdown: breakdown,
    serviceType: 'chauffeur',
  };
}
