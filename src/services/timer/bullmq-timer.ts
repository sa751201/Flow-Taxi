import { DispatchTimer, WindowExpiryCallback } from './timer-interface.js';
import { MemoryDispatchTimer } from './memory-timer.js';

export class BullMQDispatchTimer implements DispatchTimer {
  private memoryTimer = new MemoryDispatchTimer();

  constructor(_redisUrl?: string) {
    console.log('[BullMQDispatchTimer] 已全面切換至高效 MemoryDispatchTimer，不建立遠端 Redis 延遲工作');
  }

  async startWindow(orderId: string, durationSeconds: number, onExpiry: WindowExpiryCallback): Promise<void> {
    return this.memoryTimer.startWindow(orderId, durationSeconds, onExpiry);
  }

  async cancelWindow(orderId: string): Promise<void> {
    return this.memoryTimer.cancelWindow(orderId);
  }

  isWindowActive(orderId: string): boolean {
    return this.memoryTimer.isWindowActive(orderId);
  }

  async close(): Promise<void> {
    return this.memoryTimer.close();
  }
}
