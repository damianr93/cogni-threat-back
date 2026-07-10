import { envs } from 'libs/config/src/envs';
import { NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { IpWhitelistGuard } from './shared/guards/ip-whitelist.guard';
import { JwtAuthGuard } from './shared/auth/guards/jwt-auth.guard';
import { RolesGuard } from './shared/auth/guards/roles.guard';
import { WritePermissionGuard } from './shared/auth/guards/write-permission.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ZodValidationPipe());

  const ipWhitelistGuard = app.get(IpWhitelistGuard);
  const jwtAuthGuard = app.get(JwtAuthGuard);
  const rolesGuard = app.get(RolesGuard);
  const writePermissionGuard = app.get(WritePermissionGuard);
  app.useGlobalGuards(
    ipWhitelistGuard,
    jwtAuthGuard,
    rolesGuard,
    writePermissionGuard,
  );

  app.enableCors({
    origin:
      envs.CORS_ORIGIN === '*'
        ? true
        : envs.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  const port = envs.API_PORT;
  await app.listen(port);

  console.log(`🚀 Cogni-Threat API Gateway running on port ${port}`);
  console.log(`📊 Environment: ${envs.NODE_ENV}`);
  console.log(`🌐 CORS enabled for: ${envs.CORS_ORIGIN}`);

  const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    try {
      await app.close();
      console.log('✅ Application closed successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason: any, _promise: Promise<any>) => {
    // gramjs (_updateLoop) emits TIMEOUT as unhandled rejections during normal
    // MTProto long-poll cycling — these are handled internally by the library
    // and do not indicate real failures, so we suppress them here.
    if (
      reason?.message === 'TIMEOUT' &&
      reason?.stack?.includes('telegram/client/updates.js')
    ) {
      return;
    }
    console.error('Unhandled Rejection reason:', reason);
  });

  process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });
}
bootstrap();
