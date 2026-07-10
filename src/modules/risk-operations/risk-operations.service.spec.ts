import { RiskOperationsService } from './risk-operations.service';

describe('RiskOperationsService', () => {
  it('relates source alerts to assets through matching tags', async () => {
    const prisma = {
      informationAsset: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'asset-1',
            code: 'AST-ERP',
            name: 'ERP',
            tags: ['sap', 'erp'],
            criticality: 'CRITICAL',
          },
          {
            id: 'asset-2',
            code: 'AST-VPN',
            name: 'VPN',
            tags: ['vpn'],
            criticality: 'HIGH',
          },
        ]),
      },
      alertHistory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'alert-1',
            incidentId: 'CVE-2026-0001',
            eventId: 'CVE-2026-0001',
            sourceKey: 'vuln-monitor',
            serviceSource: 'vuln-monitor',
            country: '',
            victim: 'SAP NetWeaver',
            group: '',
            severity: 'CRITICAL',
            sentAt: new Date('2026-07-10T10:00:00.000Z'),
            createdAt: new Date('2026-07-10T10:00:00.000Z'),
            payload: {
              cveId: 'CVE-2026-0001',
              telegramMessage: 'SAP NetWeaver critical vulnerability',
            },
          },
        ]),
      },
    };
    const service = new RiskOperationsService(prisma as any);

    await expect(service.listRiskAlerts()).resolves.toEqual([
      expect.objectContaining({
        id: 'alert-1',
        sourceMessage: 'SAP NetWeaver critical vulnerability',
        matchedAssets: [
          expect.objectContaining({
            id: 'asset-1',
            matchedTags: ['sap'],
          }),
        ],
      }),
    ]);
  });
});
