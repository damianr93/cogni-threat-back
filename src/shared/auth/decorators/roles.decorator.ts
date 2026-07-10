import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../types/authenticated-user.type';

export const REQUIRED_ROLES = Symbol('requiredRoles');

export const Roles = (...roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
