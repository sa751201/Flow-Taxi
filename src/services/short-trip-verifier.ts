import { Order } from '../types/dispatch.js';
import {
  isDetailedDropoffAddress,
  updateOrderDropoffAndDistance,
  memoryOrders,
} from '../db/queries/orders.js';
import { geocodeAddress, calculateDrivingEta } from './google-maps.js';
import { getLineClient } from './line-client.js';
import { getAdminGroupId } from './group-whitelist.js';
import {
  createDriverShortTripPendingFlexMessage,
  createAdminShortTripVerifyFlexMessage,
} from './flex-messages.js';

export const SHORT_TRIP_MAX_KM = 5;

export interface ShortTripEvaluationResult {
  isShortTrip: boolean;
  distanceKm: number | null;
  dropoffAddress: string | null;
}

/**
 * 在司機回報結單時，確認下車地點並偵測上車地點與下車地點距離：
 * 若距離小於 5 公里（> 0 且 < 5 km），即判定為短程單
 */
export async function evaluateShortTripOnCompletion(params: {
  order: Order;
  confirmedDropoffAddress?: string | null;
}): Promise<ShortTripEvaluationResult> {
  const { order } = params;
  const confirmed = params.confirmedDropoffAddress?.trim() || '';
  const existingDropoff = order.dropoff_address?.trim() || '';
  const effectiveDropoff = confirmed || existingDropoff;

  if (!effectiveDropoff || !isDetailedDropoffAddress(effectiveDropoff)) {
    return {
      isShortTrip: false,
      distanceKm: order.distance_km ? Number(order.distance_km) : null,
      dropoffAddress: effectiveDropoff || null,
    };
  }

  const dropoffChanged = Boolean(confirmed && confirmed !== existingDropoff);
  let distanceKm: number | null =
    !dropoffChanged && order.distance_km && Number(order.distance_km) > 0
      ? Number(Number(order.distance_km).toFixed(1))
      : null;

  if (distanceKm === null || isNaN(distanceKm) || distanceKm <= 0) {
    try {
      let pickupLat = order.pickup_lat ? Number(order.pickup_lat) : NaN;
      let pickupLng = order.pickup_lng ? Number(order.pickup_lng) : NaN;
      if (isNaN(pickupLat) || isNaN(pickupLng) || !pickupLat || !pickupLng) {
        const pGeo = await geocodeAddress(order.pickup_address);
        pickupLat = pGeo.lat;
        pickupLng = pGeo.lng;
      }

      const dGeo = await geocodeAddress(effectiveDropoff);
      const eta = await calculateDrivingEta(pickupLat, pickupLng, dGeo.lat, dGeo.lng);
      distanceKm = Number((eta.distanceMeters / 1000).toFixed(1));
    } catch (err: any) {
      console.warn('[ShortTripVerifier] 計算上下車距離失敗:', err.message);
    }
  }

  const isShortTrip = Boolean(distanceKm !== null && distanceKm > 0 && distanceKm < SHORT_TRIP_MAX_KM);

  if (distanceKm !== null && distanceKm > 0) {
    await updateOrderDropoffAndDistance(order.id, effectiveDropoff, distanceKm, isShortTrip);
  } else if (dropoffChanged) {
    order.dropoff_address = effectiveDropoff;
    const mem = memoryOrders.get(order.id);
    if (mem) mem.dropoff_address = effectiveDropoff;
  }

  return {
    isShortTrip,
    distanceKm,
    dropoffAddress: effectiveDropoff,
  };
}

/**
 * 當偵測為短程單（< 5 公里）時：
 * 1. 產生並（視需要）推播 Flex Message 提示司機：系統計算為短程單，待管理員核實後會給他補單點數
 * 2. Chatbot 發送 Flex Message 到管理群組請管理員核實
 */
export async function notifyShortTripForVerification(params: {
  order: Order;
  driverId: string;
  driverName?: string | null;
  dropoffAddress: string;
  distanceKm: number;
  fare?: number | null;
  adjustNote?: string | null;
  pushToDriver?: boolean;
}) {
  const lineClient = getLineClient();
  const driverFlex = createDriverShortTripPendingFlexMessage({
    orderId: params.order.id,
    pickupAddress: params.order.pickup_address,
    dropoffAddress: params.dropoffAddress,
    distanceKm: params.distanceKm,
    fare: params.fare,
  });

  const adminFlex = createAdminShortTripVerifyFlexMessage({
    orderId: params.order.id,
    driverId: params.driverId,
    driverName: params.driverName,
    pickupAddress: params.order.pickup_address,
    dropoffAddress: params.dropoffAddress,
    distanceKm: params.distanceKm,
    fare: params.fare,
    adjustNote: params.adjustNote,
  });

  if (params.pushToDriver && params.driverId && !params.driverId.startsWith('DEV_DRIVER_')) {
    try {
      await lineClient.pushMessage({
        to: params.driverId,
        messages: [driverFlex],
      });
      console.log(`[ShortTripVerifier] ✅ 已推播短程單提示 Flex Message 至司機 1:1 OA: ${params.driverId}`);
    } catch (dErr: any) {
      console.warn('[ShortTripVerifier] 推播司機短程單提示失敗:', dErr.message);
    }
  }

  const adminGroupId = getAdminGroupId();
  if (adminGroupId) {
    try {
      await lineClient.pushMessage({
        to: adminGroupId,
        messages: [adminFlex],
      });
      console.log(`[ShortTripVerifier] ✅ 已推播短程單核實請求 Flex Message 至管理群組: ${adminGroupId}`);
    } catch (aErr: any) {
      console.warn('[ShortTripVerifier] 推播管理群組短程單核實失敗:', aErr.message);
    }
  }

  return { driverFlex, adminFlex };
}

