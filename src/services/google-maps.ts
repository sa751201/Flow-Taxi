import { env } from '../config/env.js';

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export interface EtaResult {
  durationMinutes: number;
  distanceMeters: number;
}

/**
 * 將中文地址轉換為經緯度 (Google Geocoding API)
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn('[Google Maps] 未設定 GOOGLE_MAPS_API_KEY，使用台北市中心預設座標');
    return { lat: 25.0478, lng: 121.5170, formattedAddress: address };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${apiKey}&language=zh-TW`;

    const res = await fetch(url);
    const data: any = await res.json();

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        lat: location.lat,
        lng: location.lng,
        formattedAddress: data.results[0].formatted_address || address,
      };
    } else {
      console.warn(`[Google Maps] Geocoding 無法解析地址 "${address}":`, data.status);
      return { lat: 25.0478, lng: 121.5170, formattedAddress: address };
    }
  } catch (err: any) {
    console.error('[Google Maps] Geocoding 錯誤:', err.message);
    return { lat: 25.0478, lng: 121.5170, formattedAddress: address };
  }
}

/**
 * 計算兩點間開車導航車程與距離 (Google Distance Matrix API)
 */
export async function calculateDrivingEta(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<EtaResult> {
  const apiKey = env.GOOGLE_MAPS_API_KEY;

  // 直線距離作為保底 (Haversine Formula)
  const straightDistanceMeters = calculateHaversineDistance(originLat, originLng, destLat, destLng);
  // 假設市區平均車速 30 km/h (500m/分鐘)，最少 3 分鐘
  const estimatedMins = Math.max(3, Math.round((straightDistanceMeters / 500)));

  if (!apiKey) {
    return {
      durationMinutes: estimatedMins,
      distanceMeters: straightDistanceMeters,
    };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&mode=driving&departure_time=now&key=${apiKey}&language=zh-TW`;

    const res = await fetch(url);
    const data: any = await res.json();

    if (
      data.status === 'OK' &&
      data.rows?.[0]?.elements?.[0]?.status === 'OK'
    ) {
      const element = data.rows[0].elements[0];
      const durationSeconds = element.duration_in_traffic
        ? element.duration_in_traffic.value
        : element.duration.value;
      const distanceMeters = element.distance.value;

      return {
        durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
        distanceMeters,
      };
    }

    return {
      durationMinutes: estimatedMins,
      distanceMeters: straightDistanceMeters,
    };
  } catch (err: any) {
    console.error('[Google Maps] Distance Matrix 錯誤:', err.message);
    return {
      durationMinutes: estimatedMins,
      distanceMeters: straightDistanceMeters,
    };
  }
}

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}
