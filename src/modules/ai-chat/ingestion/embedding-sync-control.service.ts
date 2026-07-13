import { Injectable } from '@nestjs/common';

export interface EmbeddingSyncStatus {
  paused: boolean;
  manualPaused: boolean;
  activeInteractiveRequests: number;
  pauseReasons: string[];
}

@Injectable()
export class EmbeddingSyncControlService {
  private manualPaused = false;
  private activeInteractiveRequests = 0;
  private waiters: Array<() => void> = [];

  pauseManual(): EmbeddingSyncStatus {
    this.manualPaused = true;
    return this.getStatus();
  }

  resumeManual(): EmbeddingSyncStatus {
    this.manualPaused = false;
    this.notifyIfResumed();
    return this.getStatus();
  }

  async runWithInteractivePriority<T>(work: () => Promise<T>): Promise<T> {
    this.activeInteractiveRequests++;
    try {
      return await work();
    } finally {
      this.activeInteractiveRequests = Math.max(
        0,
        this.activeInteractiveRequests - 1,
      );
      this.notifyIfResumed();
    }
  }

  async waitIfPaused(): Promise<void> {
    if (!this.isPaused()) return;

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  getStatus(): EmbeddingSyncStatus {
    const pauseReasons: string[] = [];
    if (this.manualPaused) pauseReasons.push('manual');
    if (this.activeInteractiveRequests > 0) pauseReasons.push('chat');

    return {
      paused: pauseReasons.length > 0,
      manualPaused: this.manualPaused,
      activeInteractiveRequests: this.activeInteractiveRequests,
      pauseReasons,
    };
  }

  private isPaused(): boolean {
    return this.manualPaused || this.activeInteractiveRequests > 0;
  }

  private notifyIfResumed(): void {
    if (this.isPaused()) return;

    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
