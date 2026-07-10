import { Injectable } from '@nestjs/common';

export type GroupsSyncJobStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface GroupsSyncProgressSnapshot {
  status: GroupsSyncJobStatus;
  total: number;
  processed: number;
  successCount: number;
  errorCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

function idleSnapshot(): GroupsSyncProgressSnapshot {
  return {
    status: 'idle',
    total: 0,
    processed: 0,
    successCount: 0,
    errorCount: 0,
    startedAt: null,
    finishedAt: null,
    message: null,
  };
}

@Injectable()
export class GroupsSyncProgressService {
  private snapshot: GroupsSyncProgressSnapshot = idleSnapshot();

  getStatus(): GroupsSyncProgressSnapshot {
    return { ...this.snapshot };
  }

  isRunning(): boolean {
    return this.snapshot.status === 'running';
  }

  start(total: number): void {
    const keepCounts = this.snapshot.status === 'running';
    this.snapshot = {
      status: 'running',
      total,
      processed: keepCounts ? this.snapshot.processed : 0,
      successCount: keepCounts ? this.snapshot.successCount : 0,
      errorCount: keepCounts ? this.snapshot.errorCount : 0,
      startedAt: this.snapshot.startedAt ?? new Date().toISOString(),
      finishedAt: null,
      message: null,
    };
  }

  update(update: {
    processed: number;
    successCount: number;
    errorCount: number;
  }): void {
    if (this.snapshot.status !== 'running') return;
    this.snapshot = {
      ...this.snapshot,
      processed: update.processed,
      successCount: update.successCount,
      errorCount: update.errorCount,
    };
  }

  complete(message: string): void {
    this.snapshot = {
      ...this.snapshot,
      status: 'completed',
      processed: this.snapshot.total,
      finishedAt: new Date().toISOString(),
      message,
    };
  }

  fail(message: string): void {
    this.snapshot = {
      ...this.snapshot,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      message,
    };
  }

  reset(): void {
    this.snapshot = idleSnapshot();
  }
}
