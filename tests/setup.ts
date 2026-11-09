import { vi } from 'vitest';

// 全域模擬 LINE Messaging API Client，避免任何單元測試向真實 LINE 群組與使用者發送推播訊息
vi.mock('./src/services/line-client.js', () => ({
  getLineClient: vi.fn(() => ({
    pushMessage: vi.fn().mockResolvedValue({}),
    replyMessage: vi.fn().mockResolvedValue({}),
    broadcast: vi.fn().mockResolvedValue({}),
    getProfile: vi.fn().mockResolvedValue({ displayName: '測試用戶' }),
    getGroupMemberProfile: vi.fn().mockResolvedValue({ displayName: '測試司機' }),
  })),
}));
