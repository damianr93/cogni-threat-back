import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, AlertSource, AlertSubscription, UserNotificationChannel } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { TelegramService, TelegramMessage } from './telegram.service';
import { TelegramChannelService } from './telegram-channel.service';
import { ConfigService } from '@nestjs/config';
import { SecretsService } from '../../shared/secret-store/secrets.service';
import { envs } from 'libs/config/src/envs';
import { VulnWatchProfilesService } from './vuln/vuln-watch-profiles.service';
import { findVulnAlertCandidates, parseVulnMonitorSettings } from './vuln/vuln-alert.processor';
import { buildVulnTelegramMessage } from './vuln/vuln-telegram-message';
import type { ProfileInput } from './vuln/vuln-alert.types';

type AlertSourceKey = 'ransomware-live' | 'telegram-channel' | 'vuln-monitor';

interface SubscriptionWithRelations extends AlertSubscription {
  source: AlertSource;
  deliveryChannel: UserNotificationChannel;
}

interface AlertEventPayload {
  sourceKey: AlertSourceKey;
  eventId: string;
  title: string;
  summary?: string | null;
  country?: string | null;
  victim?: string | null;
  group?: string | null;
  severity?: string | null;
  occurredAt: Date;
  link?: string;
  tags?: string[];
  payload: Prisma.InputJsonValue;
  message: string;
}

interface RansomwareSettings {
  countries: string[];
  groups: string[];
  keywords: string[];
}

interface TelegramChannelSettings {
  channels: string[];
  keywords: string[];
  matchType: 'any' | 'all';
  caseSensitive: boolean;
}

interface VulnMonitorSettings {
  profileIds: string[];
  severities: string[];
  cvssMin?: number;
  epssMin?: number;
  isKevOnly: boolean;
  sources: string[];
  keywords: string[];
}

const SOURCE_DEFINITIONS: Record<
  AlertSourceKey,
  { name: string; description: string; serviceType: string; defaultLookbackHours: number }
> = {
  'ransomware-live': {
    name: 'Ransomware.live',
    description: 'Incidentes confirmados reportados por ransomware.live',
    serviceType: 'ransomware',
    defaultLookbackHours: 24,
  },
  'telegram-channel': {
    name: 'Canales de Telegram',
    description: 'Mensajes recibidos desde los canales monitoreados',
    serviceType: 'telegram',
    defaultLookbackHours: 12,
  },
  'vuln-monitor': {
    name: 'Vuln Monitor',
    description: 'CVEs multi-fuente: NVD, CISA KEV, GitHub Advisory, OSV',
    serviceType: 'vuln-monitor',
    defaultLookbackHours: 2,
  },
};

@Injectable()
export class AlertProcessorService {
  private readonly logger = new Logger(AlertProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
    private readonly telegramChannelService: TelegramChannelService,
    private readonly configService: ConfigService,
    private readonly secrets: SecretsService,
    private readonly vulnProfiles: VulnWatchProfilesService,
  ) { }

  @Cron('*/5 * * * *')
  async checkForNewAlerts() {
    await this.processAlerts(true);
  }

  private async processAlerts(updateLastCheck: boolean = true) {
    this.logger.log(updateLastCheck ? 'Checking for new alerts (scheduled)' : 'Checking for new alerts (manual)');

    try {
      await this.ensureAlertSources();

      const subscriptions = await this.prisma.alertSubscription.findMany({
        where: { enabled: true },
        include: {
          source: true,
          deliveryChannel: true,
        },
      });

      if (subscriptions.length === 0) {
        this.logger.log('No active alert subscriptions found');
        return;
      }

      for (const key of Object.keys(SOURCE_DEFINITIONS) as AlertSourceKey[]) {
        const sourceSubscriptions = subscriptions.filter(
          (subscription) => subscription.source?.key === key && subscription.deliveryChannel?.isActive,
        );

        if (sourceSubscriptions.length === 0) {
          continue;
        }

        const serviceState = await this.ensureMonitoredService(key);
        const since = serviceState.lastCheck ?? this.getDefaultLookbackDate(key);

        this.logger.log(`${key}: Processing ${sourceSubscriptions.length} subscription(s)`);

        try {
          if (key === 'ransomware-live') {
            await this.handleRansomwareAlerts(sourceSubscriptions, since);
          } else if (key === 'telegram-channel') {
            await this.handleTelegramChannelAlerts(sourceSubscriptions, since);
          } else if (key === 'vuln-monitor') {
            await this.handleVulnMonitorAlerts(sourceSubscriptions, since);
          }
        } catch (error: any) {
          this.logger.error(`Error processing ${key} alerts`, error?.stack || error?.message);
        } finally {
          if (updateLastCheck) {
            await this.updateLastCheck(key);
          }
        }
      }

      this.logger.log('Alert sweep completed');
    } catch (error: any) {
      this.logger.error('Error checking for alerts', error?.stack || error?.message);
    }
  }

  private async ensureAlertSources() {
    await Promise.all(
      (Object.keys(SOURCE_DEFINITIONS) as AlertSourceKey[]).map((key) => {
        const definition = SOURCE_DEFINITIONS[key];

        return this.prisma.alertSource.upsert({
          where: { key },
          update: {
            name: definition.name,
            description: definition.description,
            serviceName: key,
            isActive: true,
          },
          create: {
            key,
            name: definition.name,
            description: definition.description,
            serviceName: key,
            isActive: true,
          },
        });
      }),
    );
  }

  private async ensureMonitoredService(key: AlertSourceKey) {
    const existing = await this.prisma.monitoredService.findUnique({
      where: { serviceName: key },
    });

    if (existing) {
      return existing;
    }

    const definition = SOURCE_DEFINITIONS[key];

    return this.prisma.monitoredService.create({
      data: {
        serviceName: key,
        serviceType: definition.serviceType,
        isActive: true,
        checkInterval: 300,
      },
    });
  }

  private getDefaultLookbackDate(key: AlertSourceKey) {
    const hours = SOURCE_DEFINITIONS[key]?.defaultLookbackHours ?? 24;
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return date;
  }

  private async handleRansomwareAlerts(subscriptions: SubscriptionWithRelations[], since: Date) {
    const incidents = await this.prisma.ransomwareVictimsData.findMany({
      where: {
        discovered: {
          gte: since,
        },
      },
      orderBy: { discovered: 'desc' },
      take: 500,
    });

    if (incidents.length === 0) {
      return;
    }

    let totalAlerts = 0;
    for (const subscription of subscriptions) {
      const settings = this.parseSettings<RansomwareSettings>(subscription.settings, {
        countries: [],
        groups: [],
        keywords: [],
      });

      const matches = incidents.filter((incident) => this.matchesRansomwareSettings(incident, settings));

      if (matches.length > 0) {
        totalAlerts += matches.length;
      }

      for (const incident of matches) {
        const telegramMessage: TelegramMessage = {
          victim: incident.victim,
          group: incident.group || 'Desconocido',
          country: incident.country || 'N/A',
          discovered: incident.discovered,
          permalink: incident.permalink || incident.postUrl || undefined,
          description: incident.description || undefined,
        };

        const event: AlertEventPayload = {
          sourceKey: 'ransomware-live',
          eventId: incident.ransomwareLiveId || incident.id,
          title: incident.victim,
          summary: incident.description,
          country: incident.country,
          victim: incident.victim,
          group: incident.group,
          severity: null,
          occurredAt: incident.discovered,
          link: telegramMessage.permalink,
          tags: settings.countries.length ? settings.countries : undefined,
          payload: this.toJsonPayload({
            incidentId: incident.id,
            ransomwareLiveId: incident.ransomwareLiveId,
            victim: incident.victim,
            group: incident.group,
            country: incident.country,
            permalink: incident.permalink,
            postUrl: incident.postUrl,
          }),
          message: this.telegramService.buildIncidentMessage(telegramMessage),
        };

        await this.dispatchEvent(subscription, event);
      }
    }

    if (totalAlerts > 0) {
      this.logger.log(`Ransomware: ${totalAlerts} alert(s) sent from ${incidents.length} incident(s)`);
    }
  }

  private matchesRansomwareSettings(incident: any, settings: RansomwareSettings) {
    if (settings.countries.length > 0 && incident.country) {
      if (!settings.countries.includes(incident.country)) {
        return false;
      }
    } else if (settings.countries.length > 0 && !incident.country) {
      return false;
    }

    if (settings.groups.length > 0) {
      const incidentGroup = (incident.group || '').toLowerCase();
      if (!settings.groups.some((group) => group.toLowerCase() === incidentGroup)) {
        return false;
      }
    }

    if (settings.keywords.length > 0) {
      const haystack = [incident.victim, incident.description, incident.activity]
        .filter(Boolean)
        .map((value) => value?.toLowerCase() || '')
        .join(' ');

      const keywordMatch = settings.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));

      if (!keywordMatch) {
        return false;
      }
    }

    return true;
  }

  private async handleTelegramChannelAlerts(subscriptions: SubscriptionWithRelations[], since: Date) {
    const messages = await this.prisma.telegramChannelMessage.findMany({
      where: {
        date: { gte: since },
      },
      orderBy: { date: 'desc' },
      take: 500,
    });

    if (messages.length === 0) {
      if (subscriptions.length > 0) {
        this.logger.warn(`Telegram: No messages found since ${since.toISOString()}`);
      }
      return;
    }

    let totalAlerts = 0;
    let subscriptionsWithoutKeywords = 0;

    for (const subscription of subscriptions) {
      const settings = this.parseSettings<TelegramChannelSettings>(subscription.settings, {
        channels: [],
        keywords: [],
        matchType: 'any',
        caseSensitive: false,
      });

      if (settings.keywords.length === 0) {
        subscriptionsWithoutKeywords++;
        continue;
      }

      const normalizedKeywords = settings.caseSensitive
        ? settings.keywords
        : settings.keywords.map((keyword) => keyword.toLowerCase());

      const filteredMessages = messages.filter((message) => {
        if (settings.channels.length > 0 && !settings.channels.includes(message.channelName)) {
          return false;
        }

        const text = settings.caseSensitive ? message.content : message.content.toLowerCase();

        if (settings.matchType === 'all') {
          return normalizedKeywords.every((keyword) => text.includes(keyword));
        }

        return normalizedKeywords.some((keyword) => text.includes(keyword));
      });

      if (filteredMessages.length > 0) {
        totalAlerts += filteredMessages.length;
      }

      for (const message of filteredMessages) {
        const matchedKeywords = normalizedKeywords.filter((keyword) => {
          const haystack = settings.caseSensitive ? message.content : message.content.toLowerCase();
          return haystack.includes(keyword);
        });

        const snippet = this.escapeHtml(this.truncate(message.content, 900));
        const keywordsText = matchedKeywords.length > 0 ? matchedKeywords.join(', ') : 'Palabras clave';

        const alertText = [
          '<b>Alerta por Canal de Telegram</b>',
          `Canal: ${this.escapeHtml(message.channelName)}`,
          `Coincidencias: ${this.escapeHtml(keywordsText)}`,
          `Fecha: ${message.date.toLocaleString('es-AR')}`,
          '',
          snippet,
        ].join('\n');

        const event: AlertEventPayload = {
          sourceKey: 'telegram-channel',
          eventId: message.messageId || message.id,
          title: `Mensaje en ${message.channelName}`,
          summary: message.content,
          occurredAt: message.date,
          link: undefined,
          tags: matchedKeywords,
          payload: this.toJsonPayload({
            messageId: message.messageId,
            channelId: message.channelId,
            channelName: message.channelName,
            matchedKeywords,
            content: message.content,
          }),
          message: alertText,
        };

        await this.dispatchEvent(subscription, event);
      }
    }

    if (subscriptionsWithoutKeywords > 0) {
      this.logger.warn(`Telegram: ${subscriptionsWithoutKeywords} subscription(s) without keywords skipped`);
    }
    if (totalAlerts > 0) {
      this.logger.log(`Telegram: ${totalAlerts} alert(s) sent from ${messages.length} message(s)`);
    }
  }

  private async handleVulnMonitorAlerts(subscriptions: SubscriptionWithRelations[], since: Date) {
    const cves = await this.prisma.vulnCve.findMany({
      where: { modifiedAt: { gte: since } },
      orderBy: { modifiedAt: 'desc' },
      take: 500,
    });

    if (cves.length === 0) return;

    const profileMap = await this.vulnProfiles.loadAllProfilesForSubscriptions(subscriptions);
    let totalAlerts = 0;
    const dashboardBase = envs.CORS_ORIGIN.split(',')[0]?.trim() || '';

    for (const subscription of subscriptions) {
      const settings = parseVulnMonitorSettings(subscription.settings);
      if (!settings.profileIds.length) {
        this.logger.warn(`VulnMonitor: subscription ${subscription.id} has no profileIds, skipping`);
        continue;
      }

      const profiles: ProfileInput[] = settings.profileIds
        .map((id) => profileMap.get(id))
        .filter((p): p is ProfileInput => Boolean(p));

      const candidates = findVulnAlertCandidates(cves, settings, profiles);

      for (const { cve, hits } of candidates) {
        totalAlerts++;
        const cvssScore = cve.cvssScore != null ? Number(cve.cvssScore).toFixed(1) : 'N/A';
        const epssScore = cve.epssScore != null ? Number(cve.epssScore).toFixed(3) : null;
        const epssPercentile = cve.epssPercentile != null ? (Number(cve.epssPercentile) * 100).toFixed(1) : null;
        const cveDisplay = cve.cveId ?? cve.id;
        const nvdLink = cve.cveId ? `https://nvd.nist.gov/vuln/detail/${cve.cveId}` : null;
        const dashboardLink = dashboardBase ? `${dashboardBase}/vuln-monitor` : null;
        const sourceBadges = cve.sources.map((s) => s.toUpperCase()).join(' · ');

        const message = buildVulnTelegramMessage({
          cveId: cveDisplay,
          title: cve.title,
          description: cve.description,
          severity: cve.severity,
          cvssScore,
          epssScore,
          epssPercentile,
          isKev: cve.isKev,
          kevRansomware: cve.kevRansomware,
          sourceBadges,
          hits,
          affectedPackages: cve.affectedPackages,
          nvdLink,
          dashboardLink,
          escapeHtml: (v) => this.escapeHtml(v),
          truncate: (v, max) => this.truncate(v, max),
        });

        const event = {
          sourceKey: 'vuln-monitor' as AlertSourceKey,
          eventId: cve.id,
          title: cveDisplay,
          summary: cve.description,
          severity: cve.severity,
          occurredAt: cve.modifiedAt ?? cve.createdAt,
          link: nvdLink ?? undefined,
          payload: this.toJsonPayload({
            cveId: cve.cveId,
            id: cve.id,
            severity: cve.severity,
            cvssScore: cve.cvssScore,
            isKev: cve.isKev,
            sources: cve.sources,
            profileHits: hits,
          }),
          message,
        };

        await this.dispatchEvent(subscription, event);
      }
    }

    if (totalAlerts > 0) {
      this.logger.log(`VulnMonitor: ${totalAlerts} alert(s) from ${cves.length} CVE(s)`);
    }
  }

  private subtractDays(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  private async dispatchEvent(subscription: SubscriptionWithRelations, event: AlertEventPayload) {
    if (!subscription.deliveryChannel || subscription.deliveryChannel.type !== 'telegram') {
      this.logger.warn(`Subscription ${subscription.id} has no Telegram channel configured`);
      return;
    }

    const botToken = await this.secrets.get('bot_token');
    if (!botToken) {
      this.logger.warn('Missing Telegram bot token');
      return;
    }

    const chatIds: string[] = Array.isArray(subscription.deliveryChannel.chatIds)
      ? subscription.deliveryChannel.chatIds
      : [];

    if (chatIds.length === 0) {
      this.logger.warn(`Subscription ${subscription.id} missing Telegram chat IDs`);
      return;
    }

    const existing = await this.prisma.alertHistory.findFirst({
      where: {
        subscriptionId: subscription.id,
        eventId: event.eventId,
      },
    });

    if (existing) {
      return;
    }

    const results = await Promise.allSettled(
      chatIds.map((chatId) =>
        this.telegramService.sendHtmlMessage(
          botToken,
          chatId,
          event.message,
        )
      )
    );
    const firstSuccessResult = results.find(
      (result) =>
        result.status === 'fulfilled' && result.value.success
    ) as PromiseFulfilledResult<{ success: boolean, messageId?: number, error?: string }> | undefined;

    const firstResult = results[0].status === 'fulfilled' ? results[0].value : { success: false, error: 'unknown error' };

    const payloadWithMessage =
      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? { ...(event.payload as Record<string, unknown>), telegramMessage: event.message }
        : { telegramMessage: event.message };

    try {
      await this.prisma.alertHistory.create({
        data: {
          incidentId: event.eventId,
          serviceSource: event.sourceKey,
          country: event.country || 'N/A',
          victim: event.victim || event.title,
          group: event.group || 'N/A',
          severity: event.severity,
          telegramSent: firstSuccessResult?.value.success || false,
          telegramMessageId: firstSuccessResult?.value.messageId?.toString(),
          sentAt: firstSuccessResult?.value.success ? new Date() : null,
          subscriptionId: subscription.id,
          userId: subscription.userId,
          sourceKey: event.sourceKey,
          eventId: event.eventId,
          payload: payloadWithMessage,
          deliveryChannelId: subscription.deliveryChannel.id,
          deliveryStatus: firstSuccessResult?.value.success ? 'SENT' : 'ERROR',
          errorMessage: firstSuccessResult?.value.success ? null : firstResult.error,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        this.logger.warn(`Alert history already recorded for event "${event.eventId}" (subscription ${subscription.id})`);
      } else {
        throw error;
      }
    }

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to send alert [${event.sourceKey}] "${subscription.name}" to chatId ${chatIds[index]}: ${result.reason}`,
        );
      } else if (!result.value.success) {
        this.logger.error(
          `Failed to send alert [${event.sourceKey}] "${subscription.name}" to chatId ${chatIds[index]}: ${result.value.error}`,
        );
      }
    });
  }

  private parseSettings<T extends Record<string, any>>(settings: Prisma.JsonValue | null, defaults: T): T {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return { ...defaults };
    }

    return { ...defaults, ...(settings as Record<string, any>) };
  }

  private escapeHtml(value: string | undefined | null) {
    if (!value) {
      return '';
    }

    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private truncate(value: string | undefined | null, limit: number) {
    if (!value) {
      return '';
    }

    if (value.length <= limit) {
      return value;
    }

    return `${value.substring(0, limit)}...`;
  }

  private toJsonPayload(data: Record<string, any>): Prisma.InputJsonValue {
    const normalize = (value: any): Prisma.InputJsonValue => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (Array.isArray(value)) {
        return value.map((item) => normalize(item)) as Prisma.InputJsonValue;
      }
      if (value && typeof value === 'object') {
        const nested: Record<string, Prisma.InputJsonValue> = {};
        for (const [key, nestedValue] of Object.entries(value)) {
          nested[key] = normalize(nestedValue);
        }
        return nested;
      }
      return value as Prisma.InputJsonValue;
    };

    return normalize(data);
  }

  private async updateLastCheck(serviceName: string) {
    await this.prisma.monitoredService.update({
      where: { serviceName },
      data: { lastCheck: new Date() },
    });
  }

  async triggerManualCheck() {
    this.logger.log('⚡ Manual check triggered');
    await this.processAlerts(false); // false = no actualizar lastCheck
    return {
      success: true,
      message: 'Manual check completed. Alerts sent without affecting scheduled task timing.',
    };
  }

  async getStatus() {
    const monitoredServices = await this.prisma.monitoredService.findMany();
    return {
      success: true,
      data: {
        services: monitoredServices,
        telegramChannel: this.telegramChannelService.getConnectionStatus(),
      },
    };
  }

  async getChannelMessages(limit: number = 50) {
    return this.telegramChannelService.getMessages(limit);
  }

  async getChannelStatus() {
    return {
      success: true,
      data: this.telegramChannelService.getConnectionStatus(),
    };
  }

  async reloadTelegramChannels() {
    await this.telegramChannelService.reloadChannels();
    return { success: true, message: 'Telegram channels reloaded' };
  }
}
