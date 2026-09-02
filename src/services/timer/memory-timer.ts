import { DispatchTimer, WindowExpiryCallback } from './timer-interface.js';

export class MemoryDispatchTimer implements DispatchTimer {
  private timers = new Map<string, NodeJS.Timeout>();
  private activeWindows = new Set<string>();

  async startWindow(orderId: string, durationSeconds: number, onExpiry: WindowExpiryCallback): Promise<void> {
    this.cancelWindow(orderId);

    this.activeWindows.add(orderId);
    const startTime = Date.now();
    console.log(`[Timer] ⏰ 訂單 ${orderId} 倒數計時開始: ${durationSeconds} 秒 (起始時間: ${new Date().toLocaleTimeString()})`);

    const targetTime = startTime + durationSeconds * 1000;

    const fireExpiry = async () => {
      if (!this.activeWindows.has(orderId)) return;
      this.cancelWindow(orderId);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[Timer] 🔔 訂單 ${orderId} 倒數時間到！實際經過: ${elapsed} 秒 (到期時間: ${new Date().toLocaleTimeString()})`);
      try {
        await onExpiry(orderId);
      } catch (err) {
        console.error(`Error executing window expiry callback for order ${orderId}:`, err);
      }
    };

    // 主要計時器 (Node.js setTimeout)
    const timeout = setTimeout(fireExpiry, durationSeconds * 1000);
    this.timers.set(orderId, timeout);

    // 備援心跳檢查 (每 2 秒主動巡檢，防止雲端容器休眠或計時器漂移漏觸發)
    const interval = setInterval(() => {
      if (!this.activeWindows.has(orderId)) {
        clearInterval(interval);
        return;
      }
      if (Date.now() >= targetTime) {
        clearInterval(interval);
        fireExpiry();
      }
    }, 2000);
  }

  async cancelWindow(orderId: string): Promise<void> {
    const existing = this.timers.get(orderId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(orderId);
    }
    this.activeWindows.delete(orderId);
  }

  isWindowActive(orderId: string): boolean {
    return this.activeWindows.has(orderId);
  }

  async close(): Promise<void> {
    for (const timeout of this.timers.values()) {
      clearTimeout(timeout);
    }
    this.timers.clear();
    this.activeWindows.clear();
  }
}
