import { Logger } from '@nestjs/common';
import { NvdCollector } from './nvd.collector';
import { makeCveRepo, makeSecrets, makeSyncStateRepository } from '@test/helpers/mock-collector-deps';
import { mockHttpGet, nvdCve, nvdPageResponse } from '@test/helpers/mock-http.service';

describe('NvdCollector', () => {
  beforeEach(() => {
    jest.spyOn(NvdCollector.prototype as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function makeCollector(opts: {
    lastSync?: Date | null;
    httpResponses?: unknown[];
    since?: Date;
    apiKey?: string;
  } = {}) {
    const { repo: syncState } = makeSyncStateRepository(
      opts.lastSync != null ? { nvd: { lastSyncAt: opts.lastSync } } : {},
    );
    const { cveRepo, upsert } = makeCveRepo();
    const http = mockHttpGet(opts.httpResponses ?? [nvdPageResponse([nvdCve('CVE-2024-0001')])]);
    const secrets = makeSecrets(opts.apiKey);
    const collector = new NvdCollector(http as never, cveRepo as never, syncState, secrets as never);
    return { collector, syncState, upsert, http, secrets };
  }

  it('uses a single HTTP range for a 5-day gap', async () => {
    const lastSync = new Date('2024-06-01T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-06T00:00:00.000Z'));
    const { collector, http } = makeCollector({ lastSync });

    await collector.sync();

    expect(http.get).toHaveBeenCalledTimes(1);
    const params = http.get.mock.calls[0][1].params;
    expect(params.lastModStartDate).toBe(lastSync.toISOString());
    expect(new Date(params.lastModEndDate).getTime()).toBeGreaterThan(lastSync.getTime());
  });

  it('splits a 200-day gap into multiple HTTP ranges', async () => {
    const lastSync = new Date('2024-01-01T00:00:00.000Z');
    const { collector, http } = makeCollector({
      lastSync,
      httpResponses: [
        nvdPageResponse([nvdCve('CVE-2024-0001')]),
        nvdPageResponse([nvdCve('CVE-2024-0002')]),
        nvdPageResponse([nvdCve('CVE-2024-0003')]),
      ],
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-07-20T00:00:00.000Z'));

    await collector.sync();

    expect(http.get).toHaveBeenCalledTimes(3);
    const ranges = http.get.mock.calls.map((call) => ({
      start: call[1].params.lastModStartDate,
      end: call[1].params.lastModEndDate,
    }));
    expect(ranges[0].start).toBe(lastSync.toISOString());
    expect(ranges).toHaveLength(3);

    jest.useRealTimers();
  });

  it('marks progress per chunk and stops on chunk failure', async () => {
    const lastSync = new Date('2024-01-01T00:00:00.000Z');
    const { collector, syncState } = makeCollector({
      lastSync,
      httpResponses: [
        nvdPageResponse([nvdCve('CVE-2024-0001')]),
        new Error('NVD unavailable'),
      ],
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-07-20T00:00:00.000Z'));

    const markProgress = jest.spyOn(syncState, 'markProgress');
    const markError = jest.spyOn(syncState, 'markError');

    const result = await collector.sync();

    expect(markProgress).toHaveBeenCalled();
    expect(markError).toHaveBeenCalled();
    expect(result.errors.length).toBeGreaterThan(0);

    jest.useRealTimers();
  });

  it('paginates within a chunk and accumulates counts', async () => {
    const lastSync = new Date('2024-06-01T00:00:00.000Z');
    const page1 = nvdPageResponse(Array.from({ length: 2000 }, (_, i) => nvdCve(`CVE-2024-${i}`)), 2500);
    const page2 = nvdPageResponse([nvdCve('CVE-2024-2500')], 2500);
    const { collector, upsert } = makeCollector({ lastSync, httpResponses: [page1, page2] });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-05T00:00:00.000Z'));

    const result = await collector.sync();

    expect(upsert).toHaveBeenCalledTimes(2001);
    expect(result.newItems + result.updatedItems).toBe(2001);

    jest.useRealTimers();
  });

  it('honours explicit since parameter for backfill', async () => {
    const lastSync = new Date('2024-06-01T00:00:00.000Z');
    const since = new Date('2024-03-01T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-05T00:00:00.000Z'));
    const { collector, http } = makeCollector({ lastSync });

    await collector.sync(since);

    const params = http.get.mock.calls[0][1].params;
    expect(params.lastModStartDate).toBe(since.toISOString());
  });

  describe('rejected API key', () => {
    const KEY = 'secret-nvd-key-123';
    const lastSync = new Date('2024-06-01T00:00:00.000Z');
    const notFound = () => Object.assign(new Error('Not Found'), { response: { status: 404 } });
    const sentKeys = (http: { get: jest.Mock }) =>
      http.get.mock.calls.map((c) => c[1].headers.apiKey as string | undefined);

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-06-05T00:00:00.000Z'));
    });

    it('retries the same page without the key after a 404', async () => {
      const { collector, http, upsert } = makeCollector({
        lastSync,
        apiKey: KEY,
        httpResponses: [notFound(), nvdPageResponse([nvdCve('CVE-2024-0001')])],
      });

      const result = await collector.sync();

      expect(sentKeys(http)).toEqual([KEY, undefined]);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(result.errors).toEqual([]);
    });

    it('does not spend a retry on the keyless fallback', async () => {
      const rateLimited = () =>
        Object.assign(new Error('Forbidden'), { response: { status: 403 } });
      const { collector, http, upsert } = makeCollector({
        lastSync,
        apiKey: KEY,
        httpResponses: [
          rateLimited(),
          rateLimited(),
          notFound(),
          nvdPageResponse([nvdCve('CVE-2024-0001')]),
        ],
      });

      const result = await collector.sync();

      expect(sentKeys(http)).toEqual([KEY, KEY, KEY, undefined]);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(result.errors).toEqual([]);
    });

    it('widens pacing to at least 6000 ms after the rejection', async () => {
      const page1 = nvdPageResponse([nvdCve('CVE-2024-0001')], 2500);
      const page2 = nvdPageResponse([nvdCve('CVE-2024-0002')], 2500);
      const { collector } = makeCollector({
        lastSync,
        apiKey: KEY,
        httpResponses: [notFound(), page1, page2],
      });
      const sleep = NvdCollector.prototype['sleep' as never] as jest.Mock;

      await collector.sync();

      expect(sleep).toHaveBeenCalledWith(6000);
      expect(sleep).not.toHaveBeenCalledWith(700);
    });

    it('stays keyless within the cool-down for the same key', async () => {
      const { collector, http } = makeCollector({
        lastSync,
        apiKey: KEY,
        httpResponses: [notFound(), nvdPageResponse([]), nvdPageResponse([])],
      });

      await collector.sync(lastSync);
      jest.setSystemTime(new Date('2024-06-05T00:30:00.000Z'));
      await collector.sync(lastSync);

      expect(sentKeys(http)).toEqual([KEY, undefined, undefined]);
    });

    it('resets the rejection when the key changes', async () => {
      const { collector, http, secrets } = makeCollector({
        lastSync,
        apiKey: KEY,
        httpResponses: [notFound(), nvdPageResponse([]), nvdPageResponse([])],
      });

      await collector.sync(lastSync);
      secrets.get.mockResolvedValue('another-key');
      await collector.sync(lastSync);

      expect(sentKeys(http)).toEqual([KEY, undefined, 'another-key']);
    });

    it('resets the rejection after one hour', async () => {
      const { collector, http } = makeCollector({
        lastSync,
        apiKey: KEY,
        httpResponses: [notFound(), nvdPageResponse([]), nvdPageResponse([])],
      });
      const now = jest.spyOn(Date, 'now');

      now.mockReturnValue(1_000_000);
      await collector.sync(lastSync);
      now.mockReturnValue(1_000_000 + 60 * 60 * 1000);
      await collector.sync(lastSync);

      expect(sentKeys(http)).toEqual([KEY, undefined, KEY]);
    });

    it('never logs the key', async () => {
      const spies = [
        jest.spyOn(Logger.prototype, 'log'),
        jest.spyOn(Logger.prototype, 'warn'),
        jest.spyOn(Logger.prototype, 'error'),
      ];
      const { collector } = makeCollector({
        lastSync,
        apiKey: KEY,
        httpResponses: [notFound(), nvdPageResponse([nvdCve('CVE-2024-0001')])],
      });

      await collector.sync();

      const logged = spies.flatMap((s) => s.mock.calls.map((c) => String(c[0])));
      expect(logged.some((m) => m.includes('rejected'))).toBe(true);
      expect(logged.some((m) => m.includes(KEY))).toBe(false);
    });
  });
});
