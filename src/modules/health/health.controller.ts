import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { Public } from '../../shared/guards/ip-whitelist.guard';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  async getHealth() {
    return this.healthService.getHealth();
  }

  @Get('database')
  @Public()
  async getDatabaseHealth() {
    return this.healthService.getDatabaseHealth();
  }

  @Get('microservices')
  @Public()
  async getMicroservicesHealth() {
    return this.healthService.getMicroservicesHealth();
  }
}
