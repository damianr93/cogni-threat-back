import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SecretsCryptoService } from '../crypto/secrets-crypto.service';
import { SecretsService } from './secrets.service';

/**
 * Global so any feature module can inject SecretsService without importing.
 * Provides the encrypted secret store + resolver used across collectors,
 * the ransomware client and the Telegram integration.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [SecretsCryptoService, SecretsService],
  exports: [SecretsService, SecretsCryptoService],
})
export class SecretsModule {}
