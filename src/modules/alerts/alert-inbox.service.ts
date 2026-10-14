import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { AlertsService } from './alerts.service';

export const INBOX_SOURCE_KEYS = [
  'ransomware-live',
  'telegram-channel',
  'vuln-monitor',
] as const;

type InboxSourceKey = (typeof INBOX_SOURCE_KEYS)[number];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function normalizeOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

function assertSourceKey(sourceKey?: string): InboxSourceKey | undefined {
  if (sourceKey === undefined) return undefined;
  if (!(INBOX_SOURCE_KEYS as readonly string[]).includes(sourceKey)) {
    throw new BadRequestException(`Unknown sourceKey: ${sourceKey}`);
  }
  return sourceKey as InboxSourceKey;
}

/** Per-user read/unread inbox over `alert_history`. */
@Injectable()
export class AlertInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  async list(
    userId: string,
    params: {
      sourceKey?: string;
      unread?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const sourceKey = assertSourceKey(params.sourceKey);
    const where: Prisma.AlertHistoryWhereInput = { userId };
    if (sourceKey) where.sourceKey = sourceKey;
    if (params.unread) where.isRead = false;

    const rows = await this.prisma.alertHistory.findMany({
      where,
      orderBy: [
        { sentAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      skip: normalizeOffset(params.offset),
      take: normalizeLimit(params.limit),
    });

    return {
      success: true,
      data: await this.alerts.withTelegramMessages(rows),
    };
  }

  async unreadCount(userId: string, sourceKey?: string) {
    const key = assertSourceKey(sourceKey);
    if (key) {
      const count = await this.countUnread(userId, key);
      return { success: true, data: { count } };
    }

    const counts = await Promise.all(
      INBOX_SOURCE_KEYS.map((source) => this.countUnread(userId, source)),
    );
    const [ransomware, telegram, vuln] = counts;
    return {
      success: true,
      data: {
        total: counts.reduce((sum, n) => sum + n, 0),
        'ransomware-live': ransomware,
        'telegram-channel': telegram,
        'vuln-monitor': vuln,
      },
    };
  }

  async markRead(id: string, userId: string) {
    const alert = await this.prisma.alertHistory.findFirst({
      where: { id, userId },
    });
    if (!alert) {
      throw new NotFoundException('Notification not found');
    }
    if (!alert.isRead) {
      await this.prisma.alertHistory.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      });
    }
    return { success: true, data: { id } };
  }

  async markAllRead(userId: string, sourceKey?: string) {
    const key = assertSourceKey(sourceKey);
    const where: Prisma.AlertHistoryWhereInput = { userId, isRead: false };
    if (key) where.sourceKey = key;

    const result = await this.prisma.alertHistory.updateMany({
      where,
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true, data: { count: result.count } };
  }

  private countUnread(userId: string, sourceKey: InboxSourceKey) {
    return this.prisma.alertHistory.count({
      where: { userId, isRead: false, sourceKey },
    });
  }
}
