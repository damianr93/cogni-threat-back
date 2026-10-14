import { Logger } from '@nestjs/common';
import { IngestionService } from './ingestion.service';

const mockEnvs = {
  RAG_CVE_EMBED_MODE: 'all',
  RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'all',
  RAG_TELEGRAM_EMBED_MODE: 'all',
};

jest.mock('libs/config/src/envs', () => ({
  get envs() {
    return mockEnvs;
  },
}));

jest.mock('./entity-serializers', () => ({
  serializeRansomwareGroup: jest.fn(() => 'group-text'),
  serializeRansomwareVictim: jest.fn(() => 'victim-text'),
  serializeVulnCve: jest.fn(() => 'cve-text'),
  serializeActor: jest.fn(() => ['actor-text']),
  serializeTelegramMessage: jest.fn(() => 'telegram-text'),
  sourceId: {
    ransomwareGroup: (g: string) => `ransomware:group:${g}`,
    ransomwareVictim: (id: string) => `ransomware:victim:${id}`,
    vulnCve: (id: string) => `vuln-monitor:cve:${id}`,
    actor: (id: string) => `actors:${id}`,
    telegramMsg: (id: string) => `telegram:msg:${id}`,
  },
}));

function build() {
  const prisma = {
    ransomwareGroupsData: {
      findMany: jest.fn().mockResolvedValue([{ group: 'lockbit' }]),
    },
    ransomwareVictimsData: {
      findMany: jest.fn().mockResolvedValue([{ ransomwareLiveId: 'v1' }]),
    },
    vulnCve: { findMany: jest.fn().mockResolvedValue([{ id: 'CVE-1' }]) },
    actorsData: { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]) },
    telegramChannelMessage: {
      findMany: jest.fn().mockResolvedValue([{ id: 'm1', messageId: 7 }]),
    },
    aiSyncState: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
  };
  const embeddings = {
    generateEmbeddingBatch: jest
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1])),
      ),
  };
  const vectors = {
    isReady: jest.fn().mockReturnValue(true),
    countAll: jest.fn().mockResolvedValue(1),
    deleteBySource: jest.fn().mockResolvedValue(undefined),
    insertChunk: jest.fn().mockResolvedValue(undefined),
    insertChunks: jest.fn().mockResolvedValue(undefined),
  };
  const control = {
    getStatus: jest.fn().mockReturnValue({ paused: false, pauseReasons: [] }),
    waitIfPaused: jest.fn().mockResolvedValue(undefined),
  };
  const service = new IngestionService(
    prisma as never,
    embeddings as never,
    vectors as never,
    control as never,
  );
  return { service, prisma, vectors, embeddings };
}

describe('IngestionService embed scope gating', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    mockEnvs.RAG_CVE_EMBED_MODE = 'all';
    mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = 'all';
    mockEnvs.RAG_TELEGRAM_EMBED_MODE = 'all';
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('embeds every source with defaults (no behaviour change)', async () => {
    const { service, prisma, vectors } = build();
    await service.ingestAll();

    expect(prisma.ransomwareVictimsData.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.telegramChannelMessage.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.vulnCve.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { updatedAt: 'asc' },
    });
    const sources = vectors.insertChunk.mock.calls.map(
      (c: [{ source: string }]) => c[0].source,
    );
    expect(sources).toEqual(
      expect.arrayContaining([
        'ransomware:victim:v1',
        'vuln-monitor:cve:CVE-1',
        'telegram:msg:7',
      ]),
    );
  });

  it('skips the telegram query and writes nothing when gated', async () => {
    mockEnvs.RAG_TELEGRAM_EMBED_MODE = 'none';
    const { service, prisma, vectors } = build();

    await service.ingestTelegramMessages();

    expect(prisma.telegramChannelMessage.findMany).not.toHaveBeenCalled();
    expect(prisma.aiSyncState.findUnique).not.toHaveBeenCalled();
    expect(prisma.aiSyncState.upsert).not.toHaveBeenCalled();
    expect(vectors.insertChunk).not.toHaveBeenCalled();
    expect(vectors.deleteBySource).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('telegram:messages — gated'),
    );
  });

  it('skips the victims query and writes nothing when gated', async () => {
    mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = 'none';
    const { service, prisma, vectors } = build();

    await service.ingestRansomwareVictims();

    expect(prisma.ransomwareVictimsData.findMany).not.toHaveBeenCalled();
    expect(vectors.insertChunk).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('ransomware:victims — gated'),
    );
  });

  it('skips the CVE query when the CVE mode is none', async () => {
    mockEnvs.RAG_CVE_EMBED_MODE = 'none';
    const { service, prisma, vectors } = build();

    await service.ingestVulnCves();

    expect(prisma.vulnCve.findMany).not.toHaveBeenCalled();
    expect(vectors.insertChunk).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('vuln-monitor:cves — gated'),
    );
  });

  it('adds isKev: true to the CVE query in kev mode', async () => {
    mockEnvs.RAG_CVE_EMBED_MODE = 'kev';
    const { service, prisma } = build();

    await service.ingestVulnCves();

    expect(prisma.vulnCve.findMany).toHaveBeenCalledWith({
      where: { isKev: true },
      orderBy: { updatedAt: 'asc' },
    });
  });

  it('combines isKev with the watermark', async () => {
    mockEnvs.RAG_CVE_EMBED_MODE = 'kev';
    const since = new Date('2026-01-01T00:00:00Z');
    const { service, prisma } = build();
    prisma.aiSyncState.findUnique.mockResolvedValue({ lastSyncAt: since });

    await service.ingestVulnCves();

    expect(prisma.vulnCve.findMany).toHaveBeenCalledWith({
      where: { isKev: true, updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
    });
  });

  it.each([
    // `all` keeps the pre-existing key: deploying the flags must not trigger a
    // full re-embed of the CVE catalogue on existing installations.
    ['all', 'vuln-monitor:cves'],
    ['kev', 'vuln-monitor:cves@kev'],
  ])(
    'keys the CVE watermark for mode %s as %s so switching mode re-embeds',
    async (mode, key) => {
      mockEnvs.RAG_CVE_EMBED_MODE = mode;
      const { service, prisma } = build();

      await service.ingestVulnCves();

      expect(prisma.aiSyncState.findUnique).toHaveBeenCalledWith({
        where: { source: key },
      });
      expect(prisma.aiSyncState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { source: key } }),
      );
    },
  );

  it('never gates groups or actors', async () => {
    mockEnvs.RAG_CVE_EMBED_MODE = 'none';
    mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = 'none';
    mockEnvs.RAG_TELEGRAM_EMBED_MODE = 'none';
    const { service, prisma } = build();

    await service.ingestRansomwareGroups();
    await service.ingestActors();

    expect(prisma.ransomwareGroupsData.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.actorsData.findMany).toHaveBeenCalledTimes(1);
  });

  it('creates no gated rows across repeated runs and cursor resets', async () => {
    mockEnvs.RAG_CVE_EMBED_MODE = 'none';
    mockEnvs.RAG_RANSOMWARE_VICTIM_EMBED_MODE = 'none';
    mockEnvs.RAG_TELEGRAM_EMBED_MODE = 'none';
    const { service, prisma, vectors } = build();
    // A reset cursor would otherwise re-select every row.
    prisma.aiSyncState.findUnique.mockResolvedValue(null);

    await service.ingestAll();
    await service.ingestAll();
    await service.ingestAll();

    const sources = [
      ...vectors.insertChunk.mock.calls.map(
        (c: [{ source: string }]) => c[0].source,
      ),
      ...vectors.insertChunks.mock.calls.flatMap((c: [{ source: string }[]]) =>
        c[0].map((chunk) => chunk.source),
      ),
    ];
    expect(
      sources.filter((s) =>
        /^(vuln-monitor|telegram|ransomware:victim)/.test(s),
      ),
    ).toEqual([]);
    expect(prisma.vulnCve.findMany).not.toHaveBeenCalled();
    expect(prisma.ransomwareVictimsData.findMany).not.toHaveBeenCalled();
    expect(prisma.telegramChannelMessage.findMany).not.toHaveBeenCalled();
  });
});

describe('IngestionService.isRunning', () => {
  it('is true only while ingestAll is in flight', async () => {
    const { service, prisma } = build();
    let release: (v: unknown[]) => void = () => undefined;
    prisma.ransomwareGroupsData.findMany.mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        release = resolve;
      }),
    );

    expect(service.isRunning()).toBe(false);
    const run = service.ingestAll();
    expect(service.isRunning()).toBe(true);
    release([]);
    await run;

    expect(service.isRunning()).toBe(false);
  });
});
