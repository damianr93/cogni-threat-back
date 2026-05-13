export type UserRole = 'ADMIN' | 'USER';

export type UserPermission = 'READ' | 'WRITE';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  permission: UserPermission;
}

export interface JwtPayload extends AuthenticatedUser {
  sub: string;
  iat?: number;
  exp?: number;
}
