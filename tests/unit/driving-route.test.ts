import { describe, it, expect } from 'vitest';
import { getDrivingRoute } from '../../src/services/google-maps.js';

describe('Driving Route Service', () => {
  it('應能成功取得起終點（台北車站到國立故宮博物院）的真實行車道路路線', async () => {
    // 台北車站: (25.0478, 121.5170) -> 故宮: (25.1016, 121.5489)
    const route = await getDrivingRoute(25.0478, 121.5170, 25.1016, 121.5489);

    expect(route).toBeDefined();
    expect(route.coordinates.length).toBeGreaterThan(5); // 蜿蜒道路應有數十個折線點
    expect(route.distanceMeters).toBeGreaterThan(6000); // 實際行車距離約 8~9 公里
    expect(route.durationSeconds).toBeGreaterThan(300);
    expect(['google', 'osrm', 'straight']).toContain(route.provider);

    // 第一點應在起點附近
    const firstPoint = route.coordinates[0];
    expect(firstPoint[0]).toBeCloseTo(25.0478, 1);
    expect(firstPoint[1]).toBeCloseTo(121.5170, 1);

    // 最後一點應在終點附近
    const lastPoint = route.coordinates[route.coordinates.length - 1];
    expect(lastPoint[0]).toBeCloseTo(25.1016, 1);
    expect(lastPoint[1]).toBeCloseTo(121.5489, 1);
  }, 10000);
});
