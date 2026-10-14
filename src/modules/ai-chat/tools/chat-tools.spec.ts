import { buildChatTools } from './chat-tools';
import { jsonSchemaMismatches } from './schema-parity';

describe('buildChatTools', () => {
  const tools = buildChatTools({
    cves: {},
    prisma: {},
  } as never);

  it('registers the CVE, ransomware and actor tools exactly once', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'search_cves',
      'get_cve',
      'cve_stats',
      'search_ransomware_victims',
      'get_ransomware_group',
      'search_actors',
    ]);
  });

  it('keeps every JSON schema in parity with its zod shape', () => {
    expect(tools.flatMap((t) => jsonSchemaMismatches(t))).toEqual([]);
  });
});
