import { describe, it, expect } from 'vitest';
import { calculateFare, calculateHaversineDistance } from '../../src/services/fare-calculator.js';

describe('Fare Calculator', () => {
  describe('calculateHaversineDistance', () => {
    it('台北 101 到台北車站距離應約 2.5~4km', () => {
      // 台北 101: 25.0339, 121.5645
      // 台北車站: 25.0478, 121.5170
      const meters = calculateHaversineDistance(25.0339, 121.5645, 25.0478, 121.5170);
      expect(meters).toBeGreaterThan(2000);
      expect(meters).toBeLessThan(6000);
    });

    it('同一點距離應為 0', () => {
      const meters = calculateHaversineDistance(25.0339, 121.5645, 25.0339, 121.5645);
      expect(meters).toBe(0);
    });
  });

  describe('市區搭乘 (city)', () => {
    it('3km 以內應收 $120（最低消費）', () => {
      // 使用非常近的兩點 (~1km 直線 → ~1.3km 修正後)
      const result = calculateFare('city', 25.0339, 121.5645, 25.0380, 121.5620);
      expect(result.serviceType).toBe('city');
      expect(result.estimatedFare).toBe(120);
      expect(result.distanceKm).toBeLessThanOrEqual(3);
    });

    it('超過 3km 應按公式計費：基本費 $60 + $20/km × 距離', () => {
      // 使用較遠的兩點 (~5km 直線 → ~6.5km 修正後)
      // 台北 101 到松山機場
      const result = calculateFare('city', 25.0339, 121.5645, 25.0638, 121.5522);
      expect(result.serviceType).toBe('city');
      expect(result.distanceKm).toBeGreaterThan(3);
      if (result.estimatedFare !== null) {
        // 車資 = 60 + 20 × distanceKm
        const expected = 60 + 20 * result.distanceKm;
        expect(result.estimatedFare).toBe(Math.round(expected));
      }
    });

    it('fareBreakdown 應包含距離與費率資訊', () => {
      const result = calculateFare('city', 25.0339, 121.5645, 25.0638, 121.5522);
      expect(result.fareBreakdown).toContain('$20');
    });
  });

  describe('酒後代駕 (chauffeur)', () => {
    it('10km 以內應收 $700（基本費）', () => {
      // ~3km 距離
      const result = calculateFare('chauffeur', 25.0339, 121.5645, 25.0478, 121.5170);
      expect(result.serviceType).toBe('chauffeur');
      expect(result.estimatedFare).toBe(700);
      expect(result.distanceKm).toBeLessThanOrEqual(10);
    });

    it('超過 10km 應按公式計費：$700 + $50/km × (距離-10)', () => {
      // 使用很遠的兩點 (~15km 直線 → ~19.5km 修正後)
      // 台北 101 到桃園
      const result = calculateFare('chauffeur', 25.0339, 121.5645, 25.0060, 121.3000);
      expect(result.serviceType).toBe('chauffeur');
      expect(result.distanceKm).toBeGreaterThan(10);
      if (result.estimatedFare !== null) {
        const extraKm = result.distanceKm - 10;
        const expected = 700 + 50 * extraKm;
        expect(result.estimatedFare).toBe(Math.round(expected));
      }
    });
  });

  describe('機場接送 (airport)', () => {
    it('應回傳 null 車資（固定價/另議）', () => {
      const result = calculateFare('airport', 25.0339, 121.5645, 25.0797, 121.2342);
      expect(result.serviceType).toBe('airport');
      expect(result.estimatedFare).toBeNull();
      expect(result.fareBreakdown).toBe('固定價/另議');
    });
  });

  describe('其他服務 (purchase / charter / moving)', () => {
    it('代購代送應回傳專人報價', () => {
      const result = calculateFare('purchase', 25.0339, 121.5645, 25.0478, 121.5170);
      expect(result.estimatedFare).toBeNull();
      expect(result.fareBreakdown).toBe('專人報價');
    });

    it('包車服務應回傳專人報價', () => {
      const result = calculateFare('charter', 25.0339, 121.5645, 25.0478, 121.5170);
      expect(result.estimatedFare).toBeNull();
      expect(result.fareBreakdown).toBe('專人報價');
    });

    it('搬運服務應回傳專人報價', () => {
      const result = calculateFare('moving', 25.0339, 121.5645, 25.0478, 121.5170);
      expect(result.estimatedFare).toBeNull();
      expect(result.fareBreakdown).toBe('專人報價');
    });
  });
});
