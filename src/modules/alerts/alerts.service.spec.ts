import { AlertsService } from './alerts.service';

function makeService() {
  const prisma = {
    ransomwareVictimsData: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new AlertsService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe('AlertsService.withTelegramMessages', () => {
  it('keeps rows that already carry a telegramMessage untouched', async () => {
    const { service, prisma } = makeService();
    const row = {
      id: 'a1',
      serviceSource: 'ransomware-live',
      incidentId: 'i1',
      eventId: null,
      payload: { telegramMessage: 'stored text' },
    };

    const result = await service.withTelegramMessages([row]);

    expect(result).toEqual([row]);
    expect(prisma.ransomwareVictimsData.findFirst).not.toHaveBeenCalled();
  });

  it('resolves a missing message and falls back to null when unresolvable', async () => {
    const { service, prisma } = makeService();
    const row = {
      id: 'a2',
      serviceSource: 'ransomware-live',
      incidentId: 'i2',
      eventId: null,
      payload: { extra: 1 },
    };

    const result = await service.withTelegramMessages([row]);

    expect(prisma.ransomwareVictimsData.findFirst).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { ...row, payload: { extra: 1, telegramMessage: null } },
    ]);
  });
});
