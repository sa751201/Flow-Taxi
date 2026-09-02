import { createGroupDispatchOrderFlexMessage } from '../src/services/flex-messages.js';
import { getLineClient } from '../src/services/line-client.js';
import { env } from '../src/config/env.js';

async function testPush() {
  const client = getLineClient();
  const flex = createGroupDispatchOrderFlexMessage({
    orderId: 'test-order-123',
    pickupAddress: '台北101',
    dropoffAddress: '台北車站',
    passengerCount: 1,
    scheduledTimeText: '即刻出發',
    bidUrl: 'https://flow-taxi-production.up.railway.app/driver/bid?orderId=test-order-123'
  });
  console.log('Flex JSON:', JSON.stringify(flex, null, 2));
  const targetGroupId = env.DRIVER_GROUP_ID || 'C5179346ac8b2f3312cabe051ca818355';
  console.log('Target Group ID:', targetGroupId);
  try {
    const res = await client.pushMessage({
      to: targetGroupId,
      messages: [flex]
    });
    console.log('Push Success:', res);
  } catch(e: any) {
    console.error('Push Error:', e.originalError ? JSON.stringify(e.originalError.response.data) : e);
  }
}
testPush();
