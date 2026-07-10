import { RansomwareService } from './ransomware.service';

describe('RansomwareService.refreshGroupDetails', () => {
  const makeService = () => {
    const apiClient = {
      Group: jest.fn(),
    };
    const dataProcessor = {
      processGroupData: jest.fn((data) => ({
        group: data.group,
        altname: data.altname ?? null,
        description: data.description ?? null,
        victims: data.victims ?? 0,
        firstseen: null,
        lastseen: null,
        added_date: null,
        has_negotiations: false,
        negotiation_count: 0,
        has_ransomnote: false,
        ransomnotes_count: 0,
        url: data.url ?? null,
        ttps: data.ttps ?? [],
        vulnerabilities: data.vulnerabilities ?? [],
        tools: data.tools ?? null,
        locations: data.locations ?? null,
      })),
    };
    const prisma = {
      ransomwareGroupsData: {
        upsert: jest.fn(),
      },
    };
    const service = new RansomwareService(
      apiClient as never,
      dataProcessor as never,
      prisma as never,
    );
    return { service, apiClient, dataProcessor, prisma };
  };

  it('fetches a single group from ransomware.live, saves it, and returns enriched data', async () => {
    const { service, apiClient, dataProcessor, prisma } = makeService();
    apiClient.Group.mockResolvedValue({
      success: true,
      data: {
        name: 'lockbit3',
        description: 'LockBit 3.0 profile',
        victims: 2016,
        ttps: ['T1486', 'T1490'],
        locations: [{ fqdn: 'example.onion' }],
      },
    });
    prisma.ransomwareGroupsData.upsert.mockResolvedValue({ group: 'lockbit3', victims: 2016, ttps: ['T1486', 'T1490'] });

    const result = await service.refreshGroupDetails('lockbit3');

    expect(apiClient.Group).toHaveBeenCalledWith('lockbit3');
    expect(dataProcessor.processGroupData).toHaveBeenCalledWith(
      expect.objectContaining({ group: 'lockbit3', name: 'lockbit3' }),
    );
    expect(prisma.ransomwareGroupsData.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { group: 'lockbit3' } }),
    );
    expect(result).toMatchObject({
      success: true,
      data: { group: 'lockbit3', victims: 2016, ttps: ['T1486', 'T1490'] },
    });
  });

  it('returns a safe error when the upstream API cannot refresh the group', async () => {
    const { service, apiClient, prisma } = makeService();
    apiClient.Group.mockResolvedValue({ success: false, error: 'HTTP 404' });

    const result = await service.refreshGroupDetails('unknown');

    expect(prisma.ransomwareGroupsData.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: 'HTTP 404' });
  });
});
