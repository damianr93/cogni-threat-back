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

  it('persists selected responsible user when creating a treatment', async () => {
    const prisma = {
      risk: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'risk-1',
          residualLikelihood: null,
          residualImpact: null,
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-2' }),
      },
      riskTreatment: {
        create: jest.fn().mockResolvedValue({ id: 'treatment-1' }),
      },
    };
    const service = new RiskOperationsService(prisma as any);

    await service.createTreatment(
      { id: 'user-1', email: 'owner@example.com', role: 'USER', permission: 'WRITE' } as any,
      {
        riskId: 'risk-1',
        strategy: 'MITIGATE',
        plan: 'Patch affected asset',
        responsibleUserId: 'user-2',
        responsibleName: 'responsible@example.com',
        residualLikelihood: 2,
        residualImpact: 3,
      },
    );

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-2', isActive: true },
      select: { id: true },
    });
    expect(prisma.riskTreatment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responsibleUserId: 'user-2',
          responsibleName: 'responsible@example.com',
          residualScore: 6,
          residualLevel: 'MEDIUM',
        }),
      }),
    );
  });

});
