import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { DispatchTimer, WindowExpiryCallback } from './timer-interface.js';

export class BullMQDispatchTimer implements DispatchTimer {
  private queue: Queue;
  private worker: Worker | null = null;
  private connection: any;
  private expiryHandler: WindowExpiryCallback | null = null;
  private queueName = 'dispatch-windows';

  constructor(redisUrl: string) {
    // ioredis client
    const Redis = (IORedis as any).default || IORedis;
    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    this.queue = new Queue(this.queueName, {
      connection: this.connection,
    });
  }

  private ensureWorker(onExpiry: WindowExpiryCallback) {
    if (!this.worker) {
      this.expiryHandler = onExpiry;
      this.worker = new Worker(
        this.queueName,
        async (job: Job) => {
          const { orderId } = job.data;
          if (this.expiryHandler) {
            await this.expiryHandler(orderId);
          }
        },
        { connection: this.connection }
      );

      this.worker.on('failed', (job, err) => {
        console.error(`BullMQ job failed for order ${job?.data?.orderId}:`, err);
      });
    } else {
      this.expiryHandler = onExpiry;
    }
  }

  async startWindow(orderId: string, durationSeconds: number, onExpiry: WindowExpiryCallback): Promise<void> {
    this.ensureWorker(onExpiry);
    const delay = durationSeconds * 1000;
    const jobId = `window-${orderId}`;

    // 移除舊的相同 jobId
    try {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        await existingJob.remove();
      }
    } catch {
      // ignore
    }

    await this.queue.add(
      'closeWindow',
      { orderId },
      {
        jobId,
        delay,
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
  }

  async cancelWindow(orderId: string): Promise<void> {
    const jobId = `window-${orderId}`;
    try {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        await existingJob.remove();
      }
    } catch (err) {
      console.warn(`Failed to cancel BullMQ window for order ${orderId}:`, err);
    }
  }

  async isWindowActive(orderId: string): Promise<boolean> {
    const jobId = `window-${orderId}`;
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) return false;
      const state = await job.getState();
      return state === 'delayed' || state === 'waiting';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    await this.queue.close();
    await this.connection.quit();
  }
}
