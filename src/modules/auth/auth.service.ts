import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { envs } from 'libs/config/src/envs';
import { PrismaService } from '../../shared/database/prisma.service';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';
import { AuthCryptoService } from './auth-crypto.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type DbUser = AuthenticatedUser & {
  passwordHash: string;
  isActive: boolean;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
  ) {}

  async login(credentials: LoginDto) {
    const user = await this.findUserByEmail(credentials.email);

    if (!user || !user.isActive || !this.crypto.verifyPassword(credentials.password, user.passwordHash)) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const profile = this.toAuthenticatedUser(user);
    const accessToken = this.crypto.signJwt({
      ...profile,
      sub: profile.id,
    });

    return {
      accessToken,
      user: profile,
    };
  }

  async register(data: RegisterDto) {
    if (!envs.PUBLIC_REGISTRATION_ENABLED) {
      throw new ForbiddenException('El registro público está deshabilitado');
    }

    const existing = await this.findUserByEmail(data.email);

    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: this.crypto.hashPassword(data.password),
        role: 'USER',
        permission: 'READ',
      },
      select: this.userSelect(),
    });

    return {
      user: this.toAuthenticatedUser(user as DbUser),
    };
  }

  async getProfile(userId: string): Promise<AuthenticatedUser> {
    const user = await this.findUserById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    return this.toAuthenticatedUser(user);
  }

  async validateToken(token: string): Promise<AuthenticatedUser> {
    const payload = this.crypto.verifyJwt(token);
    return this.getProfile(payload.sub);
  }

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        permission: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUser(id: string, data: UpdateUserDto) {
    await this.ensureUserExists(id);

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        permission: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async deleteUser(id: string) {
    await this.ensureUserExists(id);
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  private async findUserByEmail(email: string): Promise<DbUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: this.userSelect(),
    }) as Promise<DbUser | null>;
  }

  private async findUserById(id: string): Promise<DbUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect(),
    }) as Promise<DbUser | null>;
  }

  private toAuthenticatedUser(user: DbUser): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      permission: user.permission,
    };
  }

  private async ensureUserExists(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
  }

  private userSelect() {
    return {
      id: true,
      email: true,
      passwordHash: true,
      role: true,
      permission: true,
      isActive: true,
    } as const;
  }
}
