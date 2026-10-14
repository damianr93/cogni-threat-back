import { degradedNotice } from './degraded-notice';

const VOSEO = /\b(tenés|podés|usá|respondé|decilo|sos|querés|probá|sabés)\b/i;

describe('degradedNotice', () => {
  it.each([
    'model_without_tools',
    'no_tool_calls',
    'orchestrator_error',
  ] as const)('writes a neutral Spanish notice for %s', (reason) => {
    const notice = degradedNotice(reason, 'gpt-oss');

    expect(notice).toMatch(/^\n\n> \*\*Modo degradado:\*\* /);
    expect(notice).toContain('puede estar incompleta');
    expect(notice).not.toMatch(VOSEO);
  });

  it('names the model only when the reason is about the model', () => {
    expect(degradedNotice('model_without_tools', 'gpt-oss')).toContain(
      '`gpt-oss`',
    );
    expect(degradedNotice('orchestrator_error', 'gpt-oss')).not.toContain(
      'gpt-oss',
    );
  });

  it('differs per reason', () => {
    const notices = new Set([
      degradedNotice('model_without_tools', 'm'),
      degradedNotice('no_tool_calls', 'm'),
      degradedNotice('orchestrator_error', 'm'),
    ]);
    expect(notices.size).toBe(3);
  });
});
