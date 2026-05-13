import { Controller, Delete, Get, Param, Post, Put, Body } from '@nestjs/common';
import { VulnWatchProfilesService } from './vuln-watch-profiles.service';
import { VulnAlertPreviewService } from './vuln-alert-preview.service';
import { RequireWrite } from '../../../shared/auth/decorators/require-write.decorator';
import { CurrentUser } from '../../../shared/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../shared/auth/types/authenticated-user.type';

@Controller('alerts')
export class VulnWatchProfilesController {
  constructor(
    private readonly profiles: VulnWatchProfilesService,
    private readonly preview: VulnAlertPreviewService,
  ) {}

  @Get('vuln-profiles')
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.listForUser(user.id);
  }

  @Post('vuln-profiles')
  @RequireWrite()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.profiles.create(user.id, body);
  }

  @Put('vuln-profiles/:id')
  @RequireWrite()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.profiles.update(user.id, id, body);
  }

  @Delete('vuln-profiles/:id')
  @RequireWrite()
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profiles.remove(user.id, id);
  }

  @Post('vuln/preview')
  @RequireWrite()
  async previewAlerts(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.preview.preview(user.id, body);
  }
}
