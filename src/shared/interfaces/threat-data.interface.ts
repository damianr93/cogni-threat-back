export interface ThreatDataCreate {
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  tags: string[];
  publishedAt: Date;
  sourceId: string;
  rawData?: any;
}

export interface ThreatDataUpdate {
  title?: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  category?: string;
  tags?: string[];
  publishedAt?: Date;
  rawData?: any;
}

export interface ThreatDataQuery {
  limit?: number;
  offset?: number;
  severity?: string;
  category?: string;
  sourceId?: string;
  startDate?: Date;
  endDate?: Date;
}
