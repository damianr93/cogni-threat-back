import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AlertsModule } from '../alerts/alerts.module';
import { PlatformSecretsController } from './platform-secrets.controller';
import { PlatformSecretsService } from './platform-secrets.service';
import { TelegramAuthService } from './telegram-auth.service';

/**
 * Admin panel surface for managing operational secrets and running the
 * Telegram MTProto login. Depends on the global SecretsModule (resolver +
 * crypto) and on AlertsModule for restarting channel monitoring after login.
 */
@Module({
  imports: [HttpModule, AlertsModule],
  controllers: [PlatformSecretsController],
  providers: [PlatformSecretsService, TelegramAuthService],
})
export class PlatformSecretsModule {}
