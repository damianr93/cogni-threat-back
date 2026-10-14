import { Logger } from '@nestjs/common';
import { resolveEmbedScope } from './embed-scope';

describe('resolveEmbedScope', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts every valid value without warning', () => {
    expect(
      resolveEmbedScope({
        RAG_CVE_EMBED_MODE: 'kev',
        RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'none',
        RAG_TELEGRAM_EMBED_MODE: 'none',
      }),
    ).toEqual({ cve: 'kev', victims: 'none', telegram: 'none' });
    expect(
      resolveEmbedScope({
        RAG_CVE_EMBED_MODE: 'none',
        RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'all',
        RAG_TELEGRAM_EMBED_MODE: 'all',
      }),
    ).toEqual({ cve: 'none', victims: 'all', telegram: 'all' });
    expect(
      resolveEmbedScope({
        RAG_CVE_EMBED_MODE: 'all',
        RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'all',
        RAG_TELEGRAM_EMBED_MODE: 'all',
      }),
    ).toEqual({ cve: 'all', victims: 'all', telegram: 'all' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('is case and whitespace insensitive', () => {
    expect(
      resolveEmbedScope({
        RAG_CVE_EMBED_MODE: ' KEV ',
        RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'None',
        RAG_TELEGRAM_EMBED_MODE: 'ALL',
      }),
    ).toEqual({ cve: 'kev', victims: 'none', telegram: 'all' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves invalid values to the safest reduced scope with a warning', () => {
    const scope = resolveEmbedScope({
      RAG_CVE_EMBED_MODE: 'xyz',
      RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'kev',
      RAG_TELEGRAM_EMBED_MODE: '',
    });
    expect(scope).toEqual({ cve: 'kev', victims: 'none', telegram: 'none' });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0][0]).toContain('RAG_CVE_EMBED_MODE');
    expect(warn.mock.calls[0][0]).toContain('xyz');
  });

  it('treats a mode that is not allowed for a flag as invalid', () => {
    // "kev" only makes sense for CVEs.
    const scope = resolveEmbedScope({
      RAG_CVE_EMBED_MODE: 'all',
      RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'kev',
      RAG_TELEGRAM_EMBED_MODE: 'all',
    });
    expect(scope.victims).toBe('none');
  });

  it('warns once per flag and bad value, not on every resolution', () => {
    const env = {
      RAG_CVE_EMBED_MODE: 'repeat-me',
      RAG_RANSOMWARE_VICTIM_EMBED_MODE: 'all',
      RAG_TELEGRAM_EMBED_MODE: 'all',
    };
    resolveEmbedScope(env);
    resolveEmbedScope(env);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
