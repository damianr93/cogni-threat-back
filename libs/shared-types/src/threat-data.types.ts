export interface ThreatData {
  id: string;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  tags: string[];
  publishedAt: Date;
  sourceId: string;
  rawData?: any;
}

export interface DataSource {
  id: string;
  name: string;
  type: 'api' | 'scraper' | 'rss';
  endpoint?: string;
  isActive: boolean;
  lastSync?: Date;
}

export interface DashboardConfig {
  id: string;
  name: string;
  config: any;
  userId?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MicroserviceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}
