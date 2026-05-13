jest.mock('../src/modules/vuln-monitor/services/sync-scheduler.service', () => ({
  SyncSchedulerService: class MockSyncSchedulerService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { VulnMonitorController } from '../src/modules/vuln-monitor/vuln-monitor.controller';
import { VulnMonitorService } from '../src/modules/vuln-monitor/vuln-monitor.service';
import { SyncSchedulerService } from '../src/modules/vuln-monitor/services/sync-scheduler.service';
import { IpWhitelistGuard } from '../src/shared/guards/ip-whitelist.guard';
import { JwtAuthGuard } from '../src/shared/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/shared/auth/guards/roles.guard';
import { WritePermissionGuard } from '../src/shared/auth/guards/write-permission.guard';
import { ZodValidationPipe } from 'nestjs-zod';

describe('Vuln sync (e2e smoke)', () => {
  let app: INestApplication<App>;

  const vulnMonitor = {
    getSyncStatus: jest.fn().mockResolvedValue([{ source: 'nvd', status: 'ok' }]),
  };

  const scheduler = {
    triggerManualSync: jest.fn().mockResolvedValue({ started: true }),
    triggerBackfill: jest.fn().mockResolvedValue({
      started: true,
      source: 'nvd',
      since: '2024-06-01T00:00:00.000Z',
      until: '2024-06-15T00:00:00.000Z',
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [VulnMonitorController],
      providers: [
        { provide: VulnMonitorService, useValue: vulnMonitor },
        { provide: SyncSchedulerService, useValue: scheduler },
      ],
    })
      .overrideGuard(IpWhitelistGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WritePermissionGuard)
      .useValue({ canActivate: () => false })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    const allowGetOnly = {
      canActivate: (context: { switchToHttp: () => { getRequest: () => { method: string } } }) =>
        context.switchToHttp().getRequest().method === 'GET',
    };
    app.useGlobalGuards(
      { canActivate: () => true } as never,
      allowGetOnly as never,
      { canActivate: () => true } as never,
      allowGetOnly as never,
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /sync/status returns 200', () => {
    return request(app.getHttpServer()).get('/sync/status').expect(200);
  });

  it('POST /sync/backfill is blocked without auth', () => {
    return request(app.getHttpServer())
      .post('/sync/backfill')
      .send({ source: 'nvd', since: '2024-06-01T00:00:00.000Z' })
      .expect(403);
  });
});
