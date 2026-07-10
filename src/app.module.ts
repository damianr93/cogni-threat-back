import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './shared/database/database.module';
import { SecretsModule } from './shared/secret-store/secrets.module';
import { DataSourcesModule } from './modules/data-sources/data-sources.module';
import { HealthModule } from './modules/health/health.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ActorsModule } from './modules/actors/actors.module';
import { RansomwareModule } from './modules/ransomware/ransomware.module';
import { VulnMonitorModule } from './modules/vuln-monitor/vuln-monitor.module';
import { AiChatModule } from './modules/ai-chat/ai-chat.module';
import { IpWhitelistGuard } from './shared/guards/ip-whitelist.guard';
import { AuthModule } from './modules/auth/auth.module';
import { PlatformSecretsModule } from './modules/platform-secrets/platform-secrets.module';
import { JwtAuthGuard } from './shared/auth/guards/jwt-auth.guard';
import { RolesGuard } from './shared/auth/guards/roles.guard';
import { WritePermissionGuard } from './shared/auth/guards/write-permission.guard';
import { RiskOperationsModule } from './modules/risk-operations/risk-operations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    SecretsModule,
    DashboardModule,
    DataSourcesModule,
    HealthModule,
    AlertsModule,
    ActorsModule,
    RansomwareModule,
    VulnMonitorModule,
    AiChatModule,
    AuthModule,
    PlatformSecretsModule,
    RiskOperationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    IpWhitelistGuard,
    JwtAuthGuard,
    RolesGuard,
    WritePermissionGuard,
  ],
})
export class AppModule {}
