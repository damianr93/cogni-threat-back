import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'cogni-threat-api',
      version: '1.0.0',
    };
  }

  async getDatabaseHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        database: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getMicroservicesHealth() {
    const db = await this.getDatabaseHealth();
    return {
      status: db.status,
      services: {
        api: 'running',
        database: db.database,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
