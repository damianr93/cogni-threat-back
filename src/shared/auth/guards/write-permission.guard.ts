import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC } from '../../guards/ip-whitelist.guard';
import { REQUIRE_WRITE } from '../decorators/require-write.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

type AuthRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class WritePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiresWrite = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_WRITE,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresWrite) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const user = request.user;

    if (user?.role === 'ADMIN' || user?.permission === 'WRITE') {
      return true;
    }

    throw new ForbiddenException('Permiso de escritura requerido');
  }
}
