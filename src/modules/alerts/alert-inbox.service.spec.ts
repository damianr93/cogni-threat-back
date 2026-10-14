import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AlertInboxService } from './alert-inbox.service';

const USER = 'user-1';

function makeService() {
  const alertHistory = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  };
  const alerts = {
    withTelegramMessages: jest.fn(async (rows: unknown[]) => rows),
  };
  const service = new AlertInboxService(
    { alertHistory } as never,
    alerts as never,
  );
  return { service, alertHistory, alerts };
}

describe('AlertInboxService', () => {
  describe('markRead', () => {
    it('returns 404 and does not write for an unknown id', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.findFirst.mockResolvedValue(null);

      await expect(service.markRead('missing', USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(alertHistory.update).not.toHaveBeenCalled();
    });

    it('scopes the lookup by id and user so a foreign row is a 404', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.findFirst.mockResolvedValue(null);

      await expect(service.markRead('a1', USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(alertHistory.findFirst).toHaveBeenCalledWith({
        where: { id: 'a1', userId: USER },
      });
    });

    it('marks an unread row read and sets readAt', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.findFirst.mockResolvedValue({
        id: 'a1',
        isRead: false,
        readAt: null,
      });

      const result = await service.markRead('a1', USER);

      expect(result).toEqual({ success: true, data: { id: 'a1' } });
      expect(alertHistory.update).toHaveBeenCalledTimes(1);
      const arg = alertHistory.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'a1' });
      expect(arg.data.isRead).toBe(true);
      expect(arg.data.readAt).toBeInstanceOf(Date);
    });

    it('does not write for an already-read row so readAt is kept', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.findFirst.mockResolvedValue({
        id: 'a1',
        isRead: true,
        readAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.markRead('a1', USER);

      expect(result).toEqual({ success: true, data: { id: 'a1' } });
      expect(alertHistory.update).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('updates every unread row of the user and returns the count', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.markAllRead(USER);

      expect(result).toEqual({ success: true, data: { count: 4 } });
      const arg = alertHistory.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ userId: USER, isRead: false });
      expect(arg.data.isRead).toBe(true);
      expect(arg.data.readAt).toBeInstanceOf(Date);
    });

    it('scopes by source when a sourceKey is given', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.markAllRead(USER, 'vuln-monitor');

      expect(result).toEqual({ success: true, data: { count: 2 } });
      expect(alertHistory.updateMany.mock.calls[0][0].where).toEqual({
        userId: USER,
        isRead: false,
        sourceKey: 'vuln-monitor',
      });
    });

    it('rejects an unknown sourceKey with 400 and writes nothing', async () => {
      const { service, alertHistory } = makeService();

      await expect(service.markAllRead(USER, 'nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(alertHistory.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('filters unread rows only and paginates', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.findMany.mockResolvedValue([{ id: 'a1' }]);

      const result = await service.list(USER, {
        unread: true,
        limit: 20,
        offset: 40,
      });

      const arg = alertHistory.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ userId: USER, isRead: false });
      expect(arg.take).toBe(20);
      expect(arg.skip).toBe(40);
      expect(result).toEqual({ success: true, data: [{ id: 'a1' }] });
    });

    it('returns read and unread rows when unread is not set', async () => {
      const { service, alertHistory } = makeService();

      await service.list(USER, { sourceKey: 'telegram-channel' });

      expect(alertHistory.findMany.mock.calls[0][0].where).toEqual({
        userId: USER,
        sourceKey: 'telegram-channel',
      });
    });

    it('resolves telegram messages through the shared method', async () => {
      const { service, alertHistory, alerts } = makeService();
      const rows = [{ id: 'a1', payload: {} }];
      alertHistory.findMany.mockResolvedValue(rows);
      alerts.withTelegramMessages.mockResolvedValue([
        { id: 'a1', payload: { telegramMessage: 'hello' } },
      ]);

      const result = await service.list(USER);

      expect(alerts.withTelegramMessages).toHaveBeenCalledWith(rows);
      expect(result.data).toEqual([
        { id: 'a1', payload: { telegramMessage: 'hello' } },
      ]);
    });

    it.each([
      ['NaN', NaN, 50],
      ['zero', 0, 50],
      ['negative', -5, 50],
      ['undefined', undefined, 50],
      ['over the maximum', 500, 100],
      ['valid', 30, 30],
    ])('limit %s resolves to %d', async (_label, input, expected) => {
      const { service, alertHistory } = makeService();

      await service.list(USER, { limit: input });

      expect(alertHistory.findMany.mock.calls[0][0].take).toBe(expected);
    });

    it.each([
      ['NaN', NaN],
      ['negative', -3],
      ['undefined', undefined],
    ])('offset %s resolves to 0', async (_label, input) => {
      const { service, alertHistory } = makeService();

      await service.list(USER, { offset: input });

      expect(alertHistory.findMany.mock.calls[0][0].skip).toBe(0);
    });

    it('rejects an unknown sourceKey with 400', async () => {
      const { service, alertHistory } = makeService();

      await expect(
        service.list(USER, { sourceKey: 'nope' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(alertHistory.findMany).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it('returns {count} for a given sourceKey', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.count.mockResolvedValue(3);

      const result = await service.unreadCount(USER, 'vuln-monitor');

      expect(result).toEqual({ success: true, data: { count: 3 } });
      expect(alertHistory.count).toHaveBeenCalledWith({
        where: { userId: USER, isRead: false, sourceKey: 'vuln-monitor' },
      });
    });

    it('returns total plus per-source counts without a key', async () => {
      const { service, alertHistory } = makeService();
      alertHistory.count.mockImplementation(
        async ({ where }: { where: { sourceKey: string } }) =>
          ({
            'ransomware-live': 1,
            'telegram-channel': 2,
            'vuln-monitor': 3,
          })[where.sourceKey] ?? 0,
      );

      const result = await service.unreadCount(USER);

      expect(result).toEqual({
        success: true,
        data: {
          total: 6,
          'ransomware-live': 1,
          'telegram-channel': 2,
          'vuln-monitor': 3,
        },
      });
    });

    it('rejects an unknown sourceKey with 400', async () => {
      const { service } = makeService();

      await expect(service.unreadCount(USER, 'nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
