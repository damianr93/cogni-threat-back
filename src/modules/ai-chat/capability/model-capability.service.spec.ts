import { Logger } from '@nestjs/common';
import axios from 'axios';
import { ModelCapabilityService } from './model-capability.service';

jest.mock('axios');
const post = axios.post as jest.Mock;

const MINUTE = 60_000;

describe('ModelCapabilityService', () => {
  let config: { ollamaUrl: string; chatModel: string };
  let service: ModelCapabilityService;
  let now: number;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    config = { ollamaUrl: 'http://ollama.test:11434', chatModel: 'gpt-oss' };
    service = new ModelCapabilityService({
      getConfig: jest.fn().mockImplementation(() => Promise.resolve(config)),
    } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports supported when capabilities include tools and calls /api/show once', async () => {
    post.mockResolvedValue({
      data: { capabilities: ['completion', 'tools'] },
    });

    await expect(service.getToolSupport()).resolves.toBe('supported');
    await expect(service.getToolSupport()).resolves.toBe('supported');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      'http://ollama.test:11434/api/show',
      { model: 'gpt-oss' },
      { timeout: 5000 },
    );
  });

  it('reports unsupported when the capabilities array lacks tools', async () => {
    post.mockResolvedValue({ data: { capabilities: ['completion'] } });

    await expect(service.getToolSupport()).resolves.toBe('unsupported');
  });

  it('reports unknown when the capabilities field is missing', async () => {
    post.mockResolvedValue({ data: { details: {} } });

    await expect(service.getToolSupport()).resolves.toBe('unknown');
  });

  it('reports unknown (without throwing) when /api/show fails', async () => {
    post.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.getToolSupport()).resolves.toBe('unknown');
  });

  it('caches known answers for 10 minutes', async () => {
    post.mockResolvedValue({ data: { capabilities: ['tools'] } });
    await service.getToolSupport();

    now += 10 * MINUTE - 1;
    await service.getToolSupport();
    expect(post).toHaveBeenCalledTimes(1);

    now += 2;
    await service.getToolSupport();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('caches unknown answers for only 60 seconds and recovers afterwards', async () => {
    post.mockRejectedValueOnce(new Error('boom'));
    post.mockResolvedValueOnce({ data: { capabilities: ['tools'] } });

    await expect(service.getToolSupport()).resolves.toBe('unknown');
    now += 59_000;
    await expect(service.getToolSupport()).resolves.toBe('unknown');
    expect(post).toHaveBeenCalledTimes(1);

    now += 2_000;
    await expect(service.getToolSupport()).resolves.toBe('supported');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by url and model', async () => {
    post.mockResolvedValue({ data: { capabilities: ['tools'] } });
    await service.getToolSupport();

    config = { ollamaUrl: 'http://ollama.test:11434', chatModel: 'llama2' };
    await service.getToolSupport();

    expect(post).toHaveBeenCalledTimes(2);
  });

  it('markUnsupported overrides a cached supported answer without a request', async () => {
    post.mockResolvedValue({ data: { capabilities: ['tools'] } });
    await expect(service.getToolSupport()).resolves.toBe('supported');

    await service.markUnsupported();

    await expect(service.getToolSupport()).resolves.toBe('unsupported');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('markUnsupported only affects the current model', async () => {
    post.mockResolvedValue({ data: { capabilities: ['tools'] } });
    await service.markUnsupported();

    config = { ollamaUrl: 'http://ollama.test:11434', chatModel: 'other' };
    await expect(service.getToolSupport()).resolves.toBe('supported');
  });
});
