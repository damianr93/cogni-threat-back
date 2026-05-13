import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { AdminUsersController } from './admin-users.controller';
import { AuthController } from './auth.controller';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthService } from './auth.service';
import { BootstrapAdminService } from './bootstrap-admin.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController, AdminUsersController],
  providers: [AuthService, AuthCryptoService, BootstrapAdminService],
  exports: [AuthService, AuthCryptoService],
})
export class AuthModule {}
