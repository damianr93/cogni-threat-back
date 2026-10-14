import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertInboxService } from './alert-inbox.service';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';
import { CurrentUser } from '../../shared/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';
import {
  CreateNotificationChannelDto,
  UpdateNotificationChannelDto,
} from './dto/notification-channel.dto';
import {
  CreateAlertSubscriptionDto,
  UpdateAlertSubscriptionDto,
} from './dto/alert-subscription.dto';

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly inbox: AlertInboxService,
  ) {}

  @Get('sources')
  async getSources(): Promise<unknown> {
    return this.alertsService.getSources();
  }

  @Get('notification-channels')
  async getNotificationChannels(@CurrentUser() user: AuthenticatedUser) {
    return this.alertsService.getNotificationChannels(user.id);
  }

  @Post('notification-channels')
  @RequireWrite()
  async createNotificationChannel(
    @Body() data: CreateNotificationChannelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alertsService.createNotificationChannel(user.id, data);
  }

  @Put('notification-channels/:id')
  @RequireWrite()
  async updateNotificationChannel(
    @Param('id') id: string,
    @Body() data: UpdateNotificationChannelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alertsService.updateNotificationChannel(id, user.id, data);
  }

  @Delete('notification-channels/:id')
  @RequireWrite()
  async deleteNotificationChannel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alertsService.deleteNotificationChannel(id, user.id);
  }

  @Get('subscriptions')
  async getSubscriptions(@CurrentUser() user: AuthenticatedUser): Promise<any> {
    return this.alertsService.getSubscriptions(user.id);
  }

  @Post('subscriptions')
  @RequireWrite()
  async createSubscription(
    @Body() data: CreateAlertSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alertsService.createSubscription(user.id, data);
  }

  @Put('subscriptions/:id')
  @RequireWrite()
  async updateSubscription(
    @Param('id') id: string,
    @Body() data: UpdateAlertSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alertsService.updateSubscription(id, user.id, data);
  }

  @Delete('subscriptions/:id')
  @RequireWrite()
  async deleteSubscription(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alertsService.deleteSubscription(id, user.id);
  }

  @Get('history')
  async getAlertHistory(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.alertsService.getAlertHistory({
      limit: limit ? parseInt(limit, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      from,
      to,
      q: q?.trim() || undefined,
      order: order === 'asc' || order === 'desc' ? order : undefined,
    });
  }

  // Inbox routes are per user (read state), so they do not require write access.
  @Get('notifications')
  async getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sourceKey') sourceKey?: string,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inbox.list(user.id, {
      sourceKey: sourceKey?.trim() || undefined,
      unread: unread === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('notifications/unread-count')
  async getUnreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sourceKey') sourceKey?: string,
  ) {
    return this.inbox.unreadCount(user.id, sourceKey?.trim() || undefined);
  }

  // Declared before ':id/read' so 'read-all' is never captured as an id.
  @Put('notifications/read-all')
  async markAllNotificationsAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sourceKey') sourceKey?: string,
  ) {
    return this.inbox.markAllRead(user.id, sourceKey?.trim() || undefined);
  }

  @Put('notifications/:id/read')
  async markNotificationAsRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inbox.markRead(id, user.id);
  }

  @Post('trigger-manual-check')
  @RequireWrite()
  async triggerManualCheck() {
    return this.alertsService.triggerManualCheck();
  }

  @Get('status')
  async getAlertsStatus() {
    return this.alertsService.getAlertsStatus();
  }

  @Get('telegram-messages')
  async getTelegramMessages(@Query('limit') limit?: string) {
    return this.alertsService.getTelegramMessages(limit ? parseInt(limit) : 50);
  }

  @Get('telegram-status')
  async getTelegramChannelStatus() {
    return this.alertsService.getTelegramChannelStatus();
  }

  // Gestión de canales de Telegram monitoreados
  @Get('monitored-channels')
  async getMonitoredChannels() {
    return this.alertsService.getMonitoredChannels();
  }

  @Post('monitored-channels')
  @RequireWrite()
  async createMonitoredChannel(
    @Body() data: { username: string; description?: string },
  ) {
    return this.alertsService.createMonitoredChannel(data);
  }

  @Put('monitored-channels/:id')
  @RequireWrite()
  async updateMonitoredChannel(
    @Param('id') id: string,
    @Body()
    data: { username?: string; description?: string; isActive?: boolean },
  ) {
    return this.alertsService.updateMonitoredChannel(id, data);
  }

  @Delete('monitored-channels/:id')
  @RequireWrite()
  async deleteMonitoredChannel(@Param('id') id: string) {
    return this.alertsService.deleteMonitoredChannel(id);
  }

  @Post('monitored-channels/reload')
  @RequireWrite()
  async reloadMonitoredChannels() {
    return this.alertsService.reloadTelegramChannels();
  }
}
