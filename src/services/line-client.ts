import { messagingApi } from '@line/bot-sdk';
import { env } from '../config/env.js';

let client: messagingApi.MessagingApiClient | null = null;

export function getLineClient(): messagingApi.MessagingApiClient {
  if (!client) {
    if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
      throw new Error('LINE_CHANNEL_ACCESS_TOKEN is required for MessagingApiClient');
    }
    client = new messagingApi.MessagingApiClient({
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    });
  }
  return client;
}
