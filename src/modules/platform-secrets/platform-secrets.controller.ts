import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/auth/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';
import { SecretKey, SecretsService } from '../../shared/secret-store/secrets.service';
import { PlatformSecretsService } from './platform-secrets.service';
import { TelegramAuthService } from './telegram-auth.service';

/**
 * Admin-only management of operational third-party secrets.
 * Write-only contract: values are never returned — GET yields masked metadata.
 */
@Controller('admin/secrets')
@Roles('ADMIN')
export class PlatformSecretsController {
  constructor(
    private readonly secrets: SecretsService,
    private readonly platformSecrets: PlatformSecretsService,
    private readonly telegramAuth: TelegramAuthService,
  ) {}

  @Get()
  list() {
    return this.secrets.describe();
  }

  // --- Telegram MTProto login flow (declared before the generic :key routes) ---

  @Get('telegram/status')
  telegramStatus() {
    return this.telegramAuth.getConnectionStatus();
  }

  @Post('telegram/login/start')
  startTelegramLogin(
    @Body() body: { phone: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.telegramAuth.startLogin(body?.phone, user.id);
  }

  @Post('telegram/login/verify')
  verifyTelegramLogin(@Body() body: { code: string }) {
    return this.telegramAuth.verifyCode(body?.code);
  }

  @Post('telegram/login/password')
  submitTelegramPassword(@Body() body: { password: string }) {
    return this.telegramAuth.submitPassword(body?.password);
  }

  // --- Generic secret slots ---

  @Post(':key/test')
  test(@Param('key') key: string, @Body() body: { value?: string }) {
    this.assertKnown(key);
    return this.platformSecrets.test(key, body?.value);
  }

  @Put(':key')
  async set(
    @Param('key') key: string,
    @Body() body: { value: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertKnown(key);
    await this.secrets.set(key, body?.value, user.id);
    return { success: true };
  }

  @Delete(':key')
  async clear(@Param('key') key: string) {
    this.assertKnown(key);
    await this.secrets.clear(key);
    return { success: true };
  }

  private assertKnown(key: string): asserts key is SecretKey {
    if (!this.secrets.isKnownKey(key)) {
      throw new BadRequestException(`Unknown secret key: ${key}`);
    }
  }
}
