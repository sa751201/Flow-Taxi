import https from 'node:https';
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

// 台灣熱門知名地標、各大專院校、交通樞紐、醫療院所座標字典 (毫秒級超高精確度解析，100% 避開 Google API 限制)
const TAIWAN_LANDMARKS: Array<{ keywords: string[]; lat: number; lng: number; formattedAddress: string }> = [
  // 藝文觀光與知名景點
  { keywords: ['故宮博物院', '故宮'], lat: 25.1016, lng: 121.5489, formattedAddress: '國立故宮博物院（台北市士林區至善路二段221號）' },
  { keywords: ['台北101', '101大樓', '101'], lat: 25.0338, lng: 121.5645, formattedAddress: '台北101（台北市信義區信義路五段7號）' },
  { keywords: ['中正紀念堂', '自由廣場'], lat: 25.0346, lng: 121.5218, formattedAddress: '國立中正紀念堂' },
  { keywords: ['國父紀念館'], lat: 25.0401, lng: 121.5601, formattedAddress: '國立國父紀念館' },
  { keywords: ['華山1914', '華山文創', '華山'], lat: 25.0441, lng: 121.5294, formattedAddress: '華山1914文化創意產業園區' },
  { keywords: ['松山文創', '松菸'], lat: 25.0438, lng: 121.5606, formattedAddress: '松山文創園區' },
  { keywords: ['西門町', '西門紅樓', '西門捷運站', '西門站'], lat: 25.0422, lng: 121.5083, formattedAddress: '西門町商圈' },
  { keywords: ['大安森林公園'], lat: 25.0300, lng: 121.5358, formattedAddress: '大安森林公園' },
  { keywords: ['士林夜市'], lat: 25.0880, lng: 121.5246, formattedAddress: '士林夜市' },
  { keywords: ['饒河夜市', '饒河街夜市'], lat: 25.0510, lng: 121.5777, formattedAddress: '饒河街觀光夜市' },
  { keywords: ['寧夏夜市'], lat: 25.0570, lng: 121.5156, formattedAddress: '寧夏觀光夜市' },
  { keywords: ['通化夜市', '臨江街夜市'], lat: 25.0305, lng: 121.5540, formattedAddress: '通化觀光夜市' },
  { keywords: ['台北小巨蛋', '小巨蛋'], lat: 25.0518, lng: 121.5500, formattedAddress: '台北小巨蛋' },
  { keywords: ['台北大巨蛋', '大巨蛋'], lat: 25.0432, lng: 121.5600, formattedAddress: '台北大巨蛋' },

  // 大專院校 (含新生、辛亥各校門別名)
  { keywords: ['台大新生', '台大校門', '臺灣大學', '台灣大學', '台大'], lat: 25.0173, lng: 121.5398, formattedAddress: '國立臺灣大學（台北市大安區羅斯福路四段1號）' },
  { keywords: ['師範大學', '師大'], lat: 25.0264, lng: 121.5276, formattedAddress: '國立臺灣師範大學' },
  { keywords: ['政治大學', '政大'], lat: 24.9877, lng: 121.5762, formattedAddress: '國立政治大學' },
  { keywords: ['台北科技大學', '北科大', '北科'], lat: 25.0424, lng: 121.5363, formattedAddress: '國立臺北科技大學' },
  { keywords: ['台灣科技大學', '台科大', '台科'], lat: 25.0135, lng: 121.5413, formattedAddress: '國立臺灣科技大學' },
  { keywords: ['東吳大學', '東吳'], lat: 25.0934, lng: 121.5447, formattedAddress: '東吳大學外雙溪校區' },
  { keywords: ['文化大學', '文大'], lat: 25.1373, lng: 121.5406, formattedAddress: '中國文化大學' },

  // 交通樞紐與轉運站
  { keywords: ['台北車站', '北車'], lat: 25.0478, lng: 121.5170, formattedAddress: '台北車站' },
  { keywords: ['松山機場'], lat: 25.0697, lng: 121.5525, formattedAddress: '台北松山機場' },
  { keywords: ['桃園機場', '桃園國際機場'], lat: 25.0797, lng: 121.2342, formattedAddress: '臺灣桃園國際機場' },
  { keywords: ['板橋車站', '板橋高鐵'], lat: 25.0138, lng: 121.4632, formattedAddress: '板橋車站' },
  { keywords: ['南港車站', '南港高鐵'], lat: 25.0531, lng: 121.6067, formattedAddress: '南港車站' },
  { keywords: ['市府轉運站', '市政府站', '台北市政府'], lat: 25.0408, lng: 121.5656, formattedAddress: '市府轉運站' },
  { keywords: ['南港展覽館'], lat: 25.0566, lng: 121.6166, formattedAddress: '台北南港展覽館' },
  { keywords: ['忠孝復興'], lat: 25.0416, lng: 121.5438, formattedAddress: '捷運忠孝復興站' },
  { keywords: ['忠孝新生'], lat: 25.0425, lng: 121.5332, formattedAddress: '捷運忠孝新生站' },
  { keywords: ['公館站', '公館'], lat: 25.0135, lng: 121.5340, formattedAddress: '捷運公館站' },
  { keywords: ['士林站', '捷運士林'], lat: 25.0933, lng: 121.5262, formattedAddress: '捷運士林站' },

  // 醫療機構
  { keywords: ['台大醫院'], lat: 25.0416, lng: 121.5186, formattedAddress: '國立臺灣大學醫學院附設醫院' },
  { keywords: ['榮民總醫院', '台北榮總', '榮總'], lat: 25.1205, lng: 121.5197, formattedAddress: '臺北榮民總醫院' },
  { keywords: ['馬偕醫院', '台北馬偕'], lat: 25.0592, lng: 121.5228, formattedAddress: '馬偕紀念醫院' },
  { keywords: ['長庚醫院', '台北長庚'], lat: 25.0556, lng: 121.5501, formattedAddress: '長庚醫療財團法人台北長庚紀念醫院' },
  { keywords: ['三軍總醫院', '三總'], lat: 25.0700, lng: 121.5912, formattedAddress: '三軍總醫院內湖院區' },

  // 商業園區
  { keywords: ['內湖科技園區', '內科'], lat: 25.0772, lng: 121.5732, formattedAddress: '內湖科技園區' },
  { keywords: ['南港軟體園區', '南軟'], lat: 25.0598, lng: 121.6160, formattedAddress: '南港軟體工業園區' },
];

/**
 * 將中文地址轉換為精準經緯度
 * 優先級：本地知名地標字典 ➔ Google Geocoding API ➔ OpenStreetMap Nominatim 備援 ➔ 預設座標
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  if (!address || !address.trim()) {
    return { lat: 25.0478, lng: 121.5170, formattedAddress: '台北車站' };
  }

  const trimmed = address.trim();

  // 1. 本地知名地標/校園/樞紐字典匹配 (極速解析，徹底解決故宮/台大等問題)
  for (const item of TAIWAN_LANDMARKS) {
    if (item.keywords.some(k => trimmed.includes(k))) {
      console.log(`[Geocoding] 地標字典精準匹配 "${trimmed}" ➔ ${item.formattedAddress} (${item.lat}, ${item.lng})`);
      return {
        lat: item.lat,
        lng: item.lng,
        formattedAddress: item.formattedAddress,
      };
    }
  }

  // 2. 嘗試呼叫 Google Geocoding API
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        trimmed
      )}&key=${apiKey}&language=zh-TW`;

      const res = await fetch(url);
      const data: any = await res.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        console.log(`[Google Maps] Geocoding 成功解析 "${trimmed}": (${location.lat}, ${location.lng})`);
        return {
          lat: location.lat,
          lng: location.lng,
          formattedAddress: data.results[0].formatted_address || trimmed,
        };
      } else {
        console.warn(`[Google Maps] Geocoding 狀態: ${data.status} (${data.error_message || '無詳細訊息'})，切換至備援`);
      }
    } catch (err: any) {
      console.warn('[Google Maps] Geocoding 連線錯誤:', err.message);
    }
  }

  // 3. OpenStreetMap Nominatim 台灣地區地理編碼備援
  try {
    const cleanAddr = trimmed.replace(/(校門口|校門|大門|正門|側門|後門|門口|站前|站後)/g, '').trim();
    const query = cleanAddr.startsWith('台北') || cleanAddr.startsWith('新北') ? cleanAddr : '台北 ' + cleanAddr;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=tw&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'FlowTaxiApp/1.0' } });
    const data: any = await res.json();
    if (data && data[0]) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      console.log(`[Nominatim] 備援成功解析 "${trimmed}": (${lat}, ${lng}) - ${data[0].display_name}`);
      return {
        lat,
        lng,
        formattedAddress: data[0].display_name || trimmed,
      };
    }
  } catch (osmErr: any) {
    console.warn('[Nominatim] 備援解析失敗:', osmErr.message);
  }

  // 4. 若無任何結果，回傳台北車站保底並發出警告
  console.warn(`[Geocoding] 無法解析任何座標 "${trimmed}"，使用台北市中心預設座標`);
  return { lat: 25.0478, lng: 121.5170, formattedAddress: trimmed };
}

/**
 * 計算兩點間開車導航車程與距離 (Google Distance Matrix API + 台灣路網備援)
 */
export async function calculateDrivingEta(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<EtaResult> {
  const apiKey = env.GOOGLE_MAPS_API_KEY;

  // 直線距離 (Haversine Formula)
  const straightDistanceMeters = calculateHaversineDistance(originLat, originLng, destLat, destLng);
  // 台灣市區實際行車里程約為直線距離的 1.35 倍 (考慮單行道、轉彎、繞行)
  const drivingDistanceMeters = Math.round(straightDistanceMeters * 1.35);
  // 依據平均車速 (約 25 km/h ≈ 420m/分) + 基本停等紅燈 2 分鐘估算
  const estimatedMins = Math.max(3, Math.round(drivingDistanceMeters / 420) + 2);

  if (!apiKey) {
    return {
      durationMinutes: estimatedMins,
      distanceMeters: drivingDistanceMeters,
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
      distanceMeters: drivingDistanceMeters,
    };
  } catch (err: any) {
    console.error('[Google Maps] Distance Matrix 錯誤:', err.message);
    return {
      durationMinutes: estimatedMins,
      distanceMeters: drivingDistanceMeters,
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

export interface DrivingRouteResult {
  coordinates: Array<[number, number]>; // [lat, lng]
  distanceMeters: number;
  durationSeconds: number;
  provider: 'google' | 'osrm' | 'straight';
}

function decodeGooglePolyline(encoded: string): Array<[number, number]> {
  const poly: Array<[number, number]> = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    poly.push([lat / 1e5, lng / 1e5]);
  }
  return poly;
}

function fetchJsonHttpsIpv4<T = any>(urlStr: string, timeoutMs = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      urlStr,
      {
        family: 4,
        headers: { 'User-Agent': 'FlowTaxiApp/1.0' },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 取得真實道路行車路徑 (經緯度折線點列)
 * 優先級：Google Directions API ➔ OSRM 開源路網 ➔ 直線保底
 */
export async function getDrivingRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<DrivingRouteResult> {
  const apiKey = env.GOOGLE_MAPS_API_KEY;

  // 1. 若設定有 Google Maps API Key，優先使用 Google Directions API
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=driving&key=${apiKey}&language=zh-TW`;
      const res = await fetch(url);
      const data: any = await res.json();
      if (data.status === 'OK' && data.routes && data.routes[0]) {
        const route = data.routes[0];
        const leg = route.legs?.[0];
        const encoded = route.overview_polyline?.points;
        if (encoded) {
          const coordinates = decodeGooglePolyline(encoded);
          return {
            coordinates,
            distanceMeters: leg?.distance?.value || 0,
            durationSeconds: leg?.duration?.value || 0,
            provider: 'google',
          };
        }
      }
    } catch (err: any) {
      console.warn('[Google Maps] Directions API 連線失敗，切換至 OSRM:', err.message);
    }
  }

  // 2. 備援或無 API Key 時：使用 OSRM (Open Source Routing Machine) 公開路網引擎
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const data: any = await fetchJsonHttpsIpv4(osrmUrl, 6000);
    if (data && data.code === 'Ok' && data.routes && data.routes[0]) {
      const route = data.routes[0];
      const rawCoords = route.geometry?.coordinates || [];
      // OSRM coordinates 是 [lng, lat]，轉換為 [lat, lng]
      const coordinates: Array<[number, number]> = rawCoords.map((c: [number, number]) => [c[1], c[0]]);
      return {
        coordinates,
        distanceMeters: Math.round(route.distance || 0),
        durationSeconds: Math.round(route.duration || 0),
        provider: 'osrm',
      };
    }
  } catch (err: any) {
    console.warn('[OSRM] 路線規劃服務連線失敗:', err.message);
  }

  // 3. 保底：兩點直線
  const straightDist = calculateHaversineDistance(originLat, originLng, destLat, destLng);
  return {
    coordinates: [
      [originLat, originLng],
      [destLat, destLng],
    ],
    distanceMeters: straightDist,
    durationSeconds: Math.round((straightDist * 1.35) / 7),
    provider: 'straight',
  };
}
