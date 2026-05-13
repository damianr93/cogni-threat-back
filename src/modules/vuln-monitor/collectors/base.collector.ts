export interface SyncResult {
  source: string;
  newItems: number;
  updatedItems: number;
  errors: string[];
  syncedAt: Date;
}

export abstract class BaseCollector {
  abstract readonly source: string;
  abstract sync(since?: Date): Promise<SyncResult>;

  protected buildResult(partial: Partial<SyncResult> = {}): SyncResult {
    return {
      source: this.source,
      newItems: 0,
      updatedItems: 0,
      errors: [],
      syncedAt: new Date(),
      ...partial,
    };
  }
}
