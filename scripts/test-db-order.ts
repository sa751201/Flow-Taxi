import { query } from '../src/db/index.js';
import { createOrder } from '../src/db/queries/orders.js';

async function testCreateOrder() {
  console.log('Testing createOrder directly...');
  try {
    const order = await createOrder({
      customer_id: 'test_cust_123',
      service_type: 'city',
      pickup_address: '台北市信義區信義路五段7號',
      pickup_lat: 25.0339,
      pickup_lng: 121.5644,
      dropoff_address: '台北車站',
      note: '1人'
    });
    console.log('Order created successfully:', order);
  } catch(e: any) {
    console.error('Failed to create order in DB:', e.message);
  }
}
testCreateOrder();
