import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES } from '../../shared/auth/decorators/roles.decorator';
import { RolesGuard } from '../../shared/auth/guards/roles.guard';
import { AiChatController } from './ai-chat.controller';

function build() {
  const purge = {
    getReport: jest.fn().mockResolvedValue({ wouldRefuse: null }),
    purge: jest.fn().mockResolvedValue({ status: 'noop' }),
  };
  const controller = new AiChatController(
    {} as never,
    {} as never,
    purge as never,
  );
  return { controller, purge };
}

function contextFor(handler: () => unknown, role: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => AiChatController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

describe('AiChatController purge routes', () => {
  const proto = AiChatController.prototype;

  it.each([
    ['getPurgeReport', proto.getPurgeReport],
    ['purgeVectors', proto.purgeVectors],
  ])('%s is ADMIN-only: non-admin gets 403, admin passes', (_n, handler) => {
    const guard = new RolesGuard(new Reflector());

    expect(Reflect.getMetadata(REQUIRED_ROLES, handler)).toEqual(['ADMIN']);
    expect(() => guard.canActivate(contextFor(handler, 'USER'))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(contextFor(handler, 'ADMIN'))).toBe(true);
  });

  it('GET purge/report returns the report', async () => {
    const { controller, purge } = build();

    await expect(controller.getPurgeReport()).resolves.toEqual({
      success: true,
      data: { wouldRefuse: null },
    });
    expect(purge.getReport).toHaveBeenCalled();
  });

  it('POST purge forwards confirm and force', async () => {
    const { controller, purge } = build();

    await expect(
      controller.purgeVectors({ confirm: true, force: true }),
    ).resolves.toEqual({ success: true, data: { status: 'noop' } });
    expect(purge.purge).toHaveBeenCalledWith({ confirm: true, force: true });
  });

  it('routes are mapped under /ai/admin/vectors/purge', () => {
    expect(Reflect.getMetadata('path', proto.getPurgeReport)).toBe(
      'admin/vectors/purge/report',
    );
    expect(Reflect.getMetadata('path', proto.purgeVectors)).toBe(
      'admin/vectors/purge',
    );
  });
});
