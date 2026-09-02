import { describe, it, expect, vi } from 'vitest';
import * as dispatchQueries from '../../src/db/queries/dispatch.js';
import * as db from '../../src/db/index.js';

describe('Dispatch SQL and Atomic Operations', () => {
  it('findWinnerDriver 應回傳正確格式並解析長單優先權與距離', async () => {
    vi.spyOn(db, 'query').mockResolvedValue({
      rows: [
        {
          driver_id: 'driver-vip',
          distance_meters: '1240.5',
          has_long_ride_priority: true,
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const winner = await dispatchQueries.findWinnerDriver('order-xyz');

    expect(winner).not.toBeNull();
    expect(winner?.driver_id).toBe('driver-vip');
    expect(winner?.distance_meters).toBe(1240.5);
    expect(winner?.has_long_ride_priority).toBe(true);
  });

  it('atomicallyAssignDriver 僅在 rowCount 為 1 時回傳 true', async () => {
    const mockQuery = vi.spyOn(db, 'query');

    // 成功案例：影響 1 筆
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
      command: 'UPDATE',
      oid: 0,
      fields: [],
    });
    const success = await dispatchQueries.atomicallyAssignDriver('order-1', 'driver-1');
    expect(success).toBe(true);

    // 衝突案例：已被其他人搶先更新成 accepted 或 cancelled，影響 0 筆
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'UPDATE',
      oid: 0,
      fields: [],
    });
    const failed = await dispatchQueries.atomicallyAssignDriver('order-1', 'driver-2');
    expect(failed).toBe(false);
  });
});
