import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { envs } from 'libs/config/src/envs';
import { PrismaService } from '../../shared/database/prisma.service';
import { AuthCryptoService } from './auth-crypto.service';

@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
  ) {}

  async onApplicationBootstrap() {
    const email = envs.ADMIN_EMAIL?.trim().toLowerCase();
    const password = envs.ADMIN_PASSWORD;

    if (!email || !password) {
      const adminCount = await this.prisma.user.count({
        where: { role: 'ADMIN', isActive: true },
      });
      if (adminCount === 0) {
        this.logger.warn(
          'No active admin user found. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart the API.',
        );
      }
      return;
    }

    if (password.length < 8) {
      this.logger.warn(
        'ADMIN_PASSWORD is configured but shorter than 8 characters; bootstrap admin was skipped.',
      );
      return;
    }

    await this.prisma.user.upsert({
      where: { email },
      update: {
        passwordHash: this.crypto.hashPassword(password),
        role: 'ADMIN',
        permission: 'WRITE',
        isActive: true,
      },
      create: {
        email,
        passwordHash: this.crypto.hashPassword(password),
        role: 'ADMIN',
        permission: 'WRITE',
        isActive: true,
      },
    });

    this.logger.log(`Bootstrap admin ready: ${email} (ADMIN/WRITE)`);
  }
}
