import { seedMockOrders, purgeMockOrders } from '../src/services/mock-orders-manager.js';

async function main() {
  const arg = process.argv[2] || 'seed';
  if (arg === 'cleanup') {
    const force = process.argv.includes('--force');
    const count = await purgeMockOrders(force);
    console.log(`[Cleanup] 完成清理，移除筆數: ${count}`);
  } else if (arg === 'seed') {
    await seedMockOrders();
    console.log('[Seed] 10 筆模擬訂單注入完成！');
  } else {
    console.log('使用方式: npx tsx scripts/manage-mock-orders.ts [seed | cleanup [--force]]');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('執行失敗:', err);
  process.exit(1);
});
