import { Logger } from '@nestjs/common';
import { SourcePrefetcher } from './source-prefetch';

const CVE = 'vuln-monitor:cve:CVE-2024-0001';
const VICTIM = 'ransomware:victim:abc123';
const CHANNEL = 'telegram:channel:threat_intel';

type VectorRow = { source: string; category: string; text: string };

function setup(opts: { vectors?: VectorRow[]; victim?: unknown } = {}) {
  const vectors = {
    findTextBySources: jest.fn().mockResolvedValue(opts.vectors ?? []),
  };
  const prisma = {
    ransomwareVictimsData: {
      findUnique: jest.fn().mockResolvedValue(opts.victim ?? null),
    },
  };
  const runTool = jest.fn();
  const prefetcher = new SourcePrefetcher(vectors as never, prisma as never);
  return { prefetcher, vectors, prisma, runTool };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('SourcePrefetcher', () => {
  it('uses the vector text when the source has one and calls no tool', async () => {
    const { prefetcher, runTool, prisma } = setup({
      vectors: [
        { source: CVE, category: 'vuln-monitor', text: 'KEV vector text' },
      ],
    });

    const out = await prefetcher.prefetch([CVE], runTool, 4000);

    expect(out).toBe('[vuln-monitor] KEV vector text\n(fuente: ' + CVE + ')');
    expect(runTool).not.toHaveBeenCalled();
    expect(prisma.ransomwareVictimsData.findUnique).not.toHaveBeenCalled();
  });

  it('joins several chunks of one source in order', async () => {
    const { prefetcher, runTool } = setup({
      vectors: [
        { source: 'actors:actor:a1', category: 'actors', text: 'part one' },
        { source: 'actors:actor:a1', category: 'actors', text: 'part two' },
      ],
    });

    const out = await prefetcher.prefetch(['actors:actor:a1'], runTool, 4000);

    expect(out).toBe('[actors] part one\npart two\n(fuente: actors:actor:a1)');
  });

  it('hydrates a CVE without vector through get_cve', async () => {
    const { prefetcher, runTool } = setup();
    runTool.mockResolvedValue({ found: true, id: 'CVE-2024-0001', cvss: 9.8 });

    const out = await prefetcher.prefetch([CVE], runTool, 4000);

    expect(runTool).toHaveBeenCalledWith({
      name: 'get_cve',
      arguments: { cveId: 'CVE-2024-0001' },
    });
    expect(out).toBe(
      `[vuln-monitor] {"found":true,"id":"CVE-2024-0001","cvss":9.8}\n(fuente: ${CVE})`,
    );
  });

  it('hydrates a victim without vector through findUnique', async () => {
    const { prefetcher, runTool, prisma } = setup({
      victim: {
        victim: 'Acme Corp',
        group: 'lockbit',
        country: 'ES',
        activity: null,
        discovered: new Date('2026-03-02T10:00:00Z'),
        attackDate: null,
        description: null,
        website: null,
        infostealer: null,
        press: null,
      },
    });

    const out = await prefetcher.prefetch([VICTIM], runTool, 4000);

    expect(prisma.ransomwareVictimsData.findUnique).toHaveBeenCalledWith({
      where: { ransomwareLiveId: 'abc123' },
    });
    expect(out).toBe(
      `[ransomware] Víctima ransomware: Acme Corp\nGrupo atacante: lockbit\nPaís: ES\nDescubierta: 2026-03-02\n(fuente: ${VICTIM})`,
    );
    expect(runTool).not.toHaveBeenCalled();
  });

  it('hydrates a channel through search_telegram_messages with limit 5', async () => {
    const { prefetcher, runTool } = setup();
    runTool.mockResolvedValue({
      items: [
        {
          channel: 'threat_intel',
          date: '2026-03-02',
          text: 'LockBit claims X',
        },
        { channel: 'threat_intel', date: '2026-03-01', text: 'Akira claims Y' },
      ],
      total: 2,
    });

    const out = await prefetcher.prefetch([CHANNEL], runTool, 4000);

    expect(runTool).toHaveBeenCalledWith({
      name: 'search_telegram_messages',
      arguments: { channel: 'threat_intel', limit: 5 },
    });
    expect(out).toBe(
      `[telegram] [2026-03-02] LockBit claims X\n[2026-03-01] Akira claims Y\n(fuente: ${CHANNEL})`,
    );
  });

  it('keeps the selection order across mixed sources', async () => {
    const { prefetcher, runTool } = setup({
      vectors: [{ source: 'actors:actor:a1', category: 'actors', text: 'A1' }],
    });
    runTool.mockResolvedValue({ found: true, id: 'CVE-2024-0001' });

    const out = await prefetcher.prefetch(
      [CVE, 'actors:actor:a1'],
      runTool,
      4000,
    );

    expect(out.indexOf('(fuente: ' + CVE)).toBeLessThan(
      out.indexOf('(fuente: actors:actor:a1'),
    );
    expect(out).toContain('\n\n---\n\n');
  });

  it('skips sources that are missing, unknown or fail', async () => {
    const { prefetcher, runTool, prisma } = setup();
    runTool.mockImplementation(({ name }: { name: string }) =>
      name === 'get_cve'
        ? Promise.resolve({ found: false, cveId: 'CVE-2024-0001' })
        : Promise.reject(new Error('db down')),
    );

    const out = await prefetcher.prefetch(
      [CVE, VICTIM, CHANNEL, 'custom:thing:1'],
      runTool,
      4000,
    );

    expect(out).toBe('');
    expect(prisma.ransomwareVictimsData.findUnique).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledTimes(2);
  });

  it('keeps the other sources when one fails', async () => {
    const { prefetcher, runTool } = setup();
    runTool.mockImplementation(({ name }: { name: string }) =>
      name === 'get_cve'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({
            items: [{ channel: 'c', date: '2026-03-02', text: 'msg' }],
          }),
    );

    const out = await prefetcher.prefetch([CVE, CHANNEL], runTool, 4000);

    expect(out).toBe(`[telegram] [2026-03-02] msg\n(fuente: ${CHANNEL})`);
  });

  it('splits the character budget between sources and never exceeds it', async () => {
    const { prefetcher, runTool } = setup({
      vectors: [
        {
          source: 'actors:actor:a1',
          category: 'actors',
          text: 'x'.repeat(5000),
        },
        {
          source: 'actors:actor:a2',
          category: 'actors',
          text: 'y'.repeat(5000),
        },
      ],
    });

    const out = await prefetcher.prefetch(
      ['actors:actor:a1', 'actors:actor:a2'],
      runTool,
      1000,
    );

    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toContain('xxx');
    expect(out).toContain('yyy');
    expect(out).toContain('(fuente: actors:actor:a1)');
    expect(out).toContain('(fuente: actors:actor:a2)');
  });

  it('reads at most five sources and nothing for an empty selection', async () => {
    const { prefetcher, vectors, runTool } = setup();

    expect(await prefetcher.prefetch([], runTool, 4000)).toBe('');
    expect(vectors.findTextBySources).not.toHaveBeenCalled();

    const many = Array.from({ length: 8 }, (_, i) => `actors:actor:a${i}`);
    await prefetcher.prefetch(many, runTool, 4000);
    expect(vectors.findTextBySources).toHaveBeenCalledWith(many.slice(0, 5));
  });

  it('survives a vector lookup failure by falling back to SQL hydration', async () => {
    const { prefetcher, vectors, runTool } = setup();
    vectors.findTextBySources.mockRejectedValue(new Error('pgvector down'));
    runTool.mockResolvedValue({ found: true, id: 'CVE-2024-0001' });

    const out = await prefetcher.prefetch([CVE], runTool, 4000);

    expect(out).toContain('CVE-2024-0001');
  });
});
