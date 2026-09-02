import { DispatchTimer, WindowExpiryCallback } from './timer-interface.js';

export class MemoryDispatchTimer implements DispatchTimer {
  private timers = new Map<string, NodeJS.Timeout>();
  private activeWindows = new Set<string>();

  async startWindow(orderId: string, durationSeconds: number, onExpiry: WindowExpiryCallback): Promise<void> {
    this.cancelWindow(orderId);

    this.activeWindows.add(orderId);
    const timeout = setTimeout(async () => {
      this.timers.delete(orderId);
      this.activeWindows.delete(orderId);
      try {
        await onExpiry(orderId);
      } catch (err) {
        console.error(`Error executing window expiry callback for order ${orderId}:`, err);
      }
    }, durationSeconds * 1000);

    this.timers.set(orderId, timeout);
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
