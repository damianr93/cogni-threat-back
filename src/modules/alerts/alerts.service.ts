import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AlertSource } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { AlertProcessorService } from './alert-processor.service';
import { VulnWatchProfilesService } from './vuln/vuln-watch-profiles.service';
import { defaultVulnMonitorSettings } from './vuln/vuln-alert.types';

type AlertSourceKey = 'ransomware-live' | 'telegram-channel' | 'vuln-monitor';

interface SourceSchemaField {
  name: string;
  label: string;
  type: 'chips' | 'multi-select' | 'number' | 'select';
  required?: boolean;
  helperText?: string;
  min?: number;
  max?: number;
  options?: { label: string; value: string }[];
  optionsSource?: 'telegramChannels' | 'vulnProfiles';
}

interface AlertSourceSchema {
  key: AlertSourceKey;
  title: string;
  description: string;
  defaults: Record<string, any>;
  fields: SourceSchemaField[];
}

const DEFAULT_USER_ID = 'default-user';

const AVAILABLE_COUNTRIES: { label: string; value: string }[] = [
  { value: 'AR', label: 'Argentina' },
  { value: 'BR', label: 'Brasil' },
  { value: 'CL', label: 'Chile' },
  { value: 'CO', label: 'Colombia' },
  { value: 'US', label: 'Estados Unidos' },
  { value: 'MX', label: 'México' },
  { value: 'ES', label: 'España' },
  { value: 'FR', label: 'Francia' },
  { value: 'DE', label: 'Alemania' },
  { value: 'GB', label: 'Reino Unido' },
];

const SOURCE_SCHEMAS: Record<AlertSourceKey, AlertSourceSchema> = {
  'vuln-monitor': {
    key: 'vuln-monitor',
    title: 'Vuln Monitor (Multi-fuente)',
    description: 'CVEs que afectan tus perfiles de inventario (App, IT, OT)',
    defaults: defaultVulnMonitorSettings(),
    fields: [
      {
        name: 'profileIds',
        label: 'Perfiles de inventario',
        type: 'multi-select',
        optionsSource: 'vulnProfiles',
        required: true,
        helperText: 'Selecciona uno o más perfiles a monitorear',
      },
      {
        name: 'severities',
        label: 'Severidades',
        type: 'multi-select',
        options: [
          { label: 'Critical', value: 'CRITICAL' },
          { label: 'High', value: 'HIGH' },
          { label: 'Medium', value: 'MEDIUM' },
          { label: 'Low', value: 'LOW' },
        ],
      },
      {
        name: 'cvssMin',
        label: 'CVSS mínimo',
        type: 'number',
        min: 0,
        max: 10,
        helperText: 'Umbral CVSSv3. Usa 0 para desactivar',
      },
      {
        name: 'epssMin',
        label: 'EPSS mínimo',
        type: 'number',
        min: 0,
        max: 1,
        helperText: 'Probabilidad de explotación (0–1). Ej: 0.3',
      },
      {
        name: 'isKevOnly',
        label: 'Solo CISA KEV',
        type: 'select',
        options: [
          { label: 'No (todas las fuentes)', value: 'false' },
          { label: 'Sí (solo exploits confirmados)', value: 'true' },
        ],
      },
      {
        name: 'sources',
        label: 'Fuentes a incluir',
        type: 'multi-select',
        options: [
          { label: 'NVD', value: 'nvd' },
          { label: 'CISA KEV', value: 'kev' },
          { label: 'GitHub Advisory', value: 'github' },
          { label: 'OSV', value: 'osv' },
        ],
        helperText: 'Vacío = todas las fuentes',
      },
      {
        name: 'keywords',
        label: 'Palabras clave',
        type: 'chips',
        helperText: 'Busca en ID, título y descripción del CVE',
      },
    ],
  },
  'ransomware-live': {
    key: 'ransomware-live',
    title: 'Incidentes de ransomware.live',
    description: 'Alertas por víctimas recientes publicadas en ransomware.live',
    defaults: {
      countries: [],
      groups: [],
      keywords: [],
    },
    fields: [
      {
        name: 'countries',
        label: 'Países a monitorear',
        type: 'multi-select',
        options: AVAILABLE_COUNTRIES,
        helperText: 'Selecciona uno o varios países objetivo',
      },
      {
        name: 'groups',
        label: 'Grupos de ransomware',
        type: 'chips',
        helperText: 'Opcional. Coincidencias exactas por grupo',
      },
      {
        name: 'keywords',
        label: 'Palabras clave',
        type: 'chips',
        helperText: 'Opcional. Se busca en descripción/actividad de la víctima',
      },
    ],
  },
  'telegram-channel': {
    key: 'telegram-channel',
    title: 'Canales de Telegram',
    description: 'Mensajes entrantes desde los canales monitoreados vía MTProto',
    defaults: {
      channels: [],
      keywords: [],
      matchType: 'any',
    },
    fields: [
      {
        name: 'channels',
        label: 'Canales a vigilar',
        type: 'multi-select',
        optionsSource: 'telegramChannels',
        helperText: 'Si se deja vacío se evalúan todos los canales configurados',
      },
      {
        name: 'keywords',
        label: 'Palabras clave (obligatorio)',
        type: 'chips',
        required: true,
        helperText: 'El mensaje debe contener estas palabras para disparar la alerta',
      },
      {
        name: 'matchType',
        label: 'Modo de coincidencia',
        type: 'select',
        options: [
          { label: 'Cualquiera', value: 'any' },
          { label: 'Todas', value: 'all' },
        ],
        helperText: 'Define si necesita una o todas las palabras configuradas',
      },
    ],
  },
};

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alertProcessor: AlertProcessorService,
    private readonly vulnProfiles: VulnWatchProfilesService,
  ) {}

  async getSources() {
    const sources = await this.prisma.alertSource.findMany({
      orderBy: { name: 'asc' },
    });

    return sources.map((source) => ({
      ...source,
      schema: SOURCE_SCHEMAS[source.key as AlertSourceKey] ?? null,
    }));
  }

  async getNotificationChannels(userId: string = DEFAULT_USER_ID) {
    return this.prisma.userNotificationChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createNotificationChannel(userId: string, data: { label?: string; chatIds: string[] }) {
    return this.prisma.userNotificationChannel.create({
      data: {
        userId,
        type: 'telegram',
        label: data.label ?? 'Telegram',
        botToken: null, // Ya no se guarda, se usa BOT_TOKEN de env
        chatIds: data.chatIds,
      },
    });
  }

  async updateNotificationChannel(
    id: string,
    userId: string,
    data: { label?: string; chatIds?: string[]; isActive?: boolean },
  ) {
    const channel = await this.prisma.userNotificationChannel.findFirst({
      where: { id, userId },
    });

    if (!channel) {
      throw new NotFoundException('Notification channel not found');
    }

    return this.prisma.userNotificationChannel.update({
      where: { id },
      data,
    });
  }

  async deleteNotificationChannel(id: string, userId: string) {
    const channel = await this.prisma.userNotificationChannel.findFirst({
      where: { id, userId },
      include: {
        subscriptions: true,
      },
    });

    if (!channel) {
      throw new NotFoundException('Notification channel not found');
    }

    if (channel.subscriptions.length > 0) {
      throw new BadRequestException('No se puede borrar un canal con suscripciones activas');
    }

    await this.prisma.userNotificationChannel.delete({
      where: { id },
    });

    return { success: true };
  }

  async getSubscriptions(userId: string = DEFAULT_USER_ID) {
    const items = await this.prisma.alertSubscription.findMany({
      where: { userId },
      include: {
        source: true,
        deliveryChannel: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((subscription) => ({
      ...subscription,
      source: {
        ...subscription.source,
        schema: SOURCE_SCHEMAS[subscription.source.key as AlertSourceKey] ?? null,
      },
    }));
  }

  async createSubscription(
    userId: string,
    data: { sourceKey: AlertSourceKey; name: string; enabled?: boolean; deliveryChannelId: string; settings?: Prisma.JsonValue },
  ) {
    const source = await this.findSourceByKey(data.sourceKey);
    await this.ensureChannelOwnership(data.deliveryChannelId, userId);
    const settings = (data.settings ?? SOURCE_SCHEMAS[data.sourceKey].defaults) as Prisma.InputJsonValue;

    if (data.sourceKey === 'vuln-monitor') {
      await this.validateVulnSubscriptionSettings(userId, settings);
    }

    return this.prisma.alertSubscription.create({
      data: {
        userId,
        sourceId: source.id,
        name: data.name,
        enabled: data.enabled ?? true,
        deliveryChannelId: data.deliveryChannelId,
        settings,
      },
      include: {
        source: true,
        deliveryChannel: true,
      },
    });
  }

  async updateSubscription(
    id: string,
    userId: string,
    data: {
      name?: string;
      enabled?: boolean;
      deliveryChannelId?: string;
      settings?: Prisma.JsonValue;
    },
  ) {
    const subscription = await this.prisma.alertSubscription.findFirst({
      where: { id, userId },
      include: { source: true },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (data.deliveryChannelId) {
      await this.ensureChannelOwnership(data.deliveryChannelId, userId);
    }

    const updatePayload: Prisma.AlertSubscriptionUpdateInput = {};

    if (data.name !== undefined) {
      updatePayload.name = data.name;
    }
    if (data.enabled !== undefined) {
      updatePayload.enabled = data.enabled;
    }
    if (data.deliveryChannelId !== undefined) {
      updatePayload.deliveryChannel = {
        connect: { id: data.deliveryChannelId },
      };
    }
    if (data.settings !== undefined) {
      if (subscription.source.key === 'vuln-monitor') {
        await this.validateVulnSubscriptionSettings(userId, data.settings);
      }
      updatePayload.settings = data.settings as Prisma.InputJsonValue;
    }

    return this.prisma.alertSubscription.update({
      where: { id },
      data: updatePayload,
      include: {
        source: true,
        deliveryChannel: true,
      },
    });
  }

  async deleteSubscription(id: string, userId: string) {
    const subscription = await this.prisma.alertSubscription.findFirst({
      where: { id, userId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    await this.prisma.alertSubscription.delete({
      where: { id },
    });

    return { success: true };
  }

  async getAlertHistory(params: {
    limit?: number;
    page?: number;
    from?: string;
    to?: string;
    q?: string;
    order?: 'asc' | 'desc';
  } = {}) {
    const limit = Math.min(params.limit ?? 50, 200);
    const page = Math.max(params.page ?? 1, 1);
    const order = params.order ?? 'desc';
    const where: Prisma.AlertHistoryWhereInput = {};

    if (params.from || params.to) {
      const fromDate = params.from ? new Date(params.from) : undefined;
      const toDate = params.to ? new Date(params.to) : undefined;
      if (toDate) toDate.setHours(23, 59, 59, 999);
      where.sentAt = {};
      if (fromDate) (where.sentAt as Prisma.DateTimeFilter).gte = fromDate;
      if (toDate) (where.sentAt as Prisma.DateTimeFilter).lte = toDate;
    }

    if (params.q && params.q.trim().length >= 1) {
      const search = params.q.trim();

      // Run both lookups in parallel
      const [payloadAlertIds, extraIncidentIds] = await Promise.all([
        this.findAlertIdsByPayloadText(search),
        this.findRelatedIncidentIds(search),
      ]);

      where.OR = [
        { incidentId: { contains: search, mode: 'insensitive' } },
        { serviceSource: { contains: search, mode: 'insensitive' } },
        { country: { contains: search, mode: 'insensitive' } },
        { victim: { contains: search, mode: 'insensitive' } },
        { group: { contains: search, mode: 'insensitive' } },
        { severity: { contains: search, mode: 'insensitive' } },
        { deliveryStatus: { contains: search, mode: 'insensitive' } },
        { sourceKey: { contains: search, mode: 'insensitive' } },
        { eventId: { contains: search, mode: 'insensitive' } },
        { errorMessage: { contains: search, mode: 'insensitive' } },
        ...(payloadAlertIds.length > 0 ? [{ id: { in: payloadAlertIds } }] : []),
        ...(extraIncidentIds.length > 0 ? [{ incidentId: { in: extraIncidentIds } }] : []),
      ];
    }

    const orderBy =
      order === 'desc'
        ? [
            { sentAt: { sort: 'desc' as const, nulls: 'last' as const } },
            { createdAt: 'desc' as const },
          ]
        : [
            { sentAt: { sort: 'asc' as const, nulls: 'first' as const } },
            { createdAt: 'asc' as const },
          ];

    const [total, rawData] = await Promise.all([
      this.prisma.alertHistory.count({ where }),
      this.prisma.alertHistory.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const data = await Promise.all(
      rawData.map(async (item) => {
        const payload = (item.payload as Record<string, unknown> | null) || {};
        if (typeof payload.telegramMessage === 'string' && payload.telegramMessage.length > 0) {
          return item;
        }
        const resolved = await this.resolveAlertMessage(
          item.serviceSource,
          item.incidentId,
          item.eventId,
          payload,
        );
        return {
          ...item,
          payload: { ...payload, telegramMessage: resolved || null },
        };
      }),
    );

    const totalPages = Math.ceil(total / limit) || 1;
    return {
      success: true,
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /** Search inside the payload JSON column for telegramMessage text matches (PostgreSQL JSONB) */
  private async findAlertIdsByPayloadText(search: string): Promise<string[]> {
    try {
      const results = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM alert_history
        WHERE payload IS NOT NULL
          AND LOWER(payload::text) LIKE LOWER(${`%${search}%`})
      `;
      return results.map((r) => r.id);
    } catch {
      return [];
    }
  }

  /**
   * Search in the source data tables (victims, CVEs, Telegram messages) and
   * return the incidentIds that match the query in their full text fields.
   */
  private async findRelatedIncidentIds(search: string): Promise<string[]> {
    const ids: string[] = [];

    try {
      // Ransomware victims: search in description, activity, victim name, group
      const victims = await this.prisma.ransomwareVictimsData.findMany({
        where: {
          OR: [
            { description: { contains: search, mode: 'insensitive' } },
            { activity: { contains: search, mode: 'insensitive' } },
            { victim: { contains: search, mode: 'insensitive' } },
            { group: { contains: search, mode: 'insensitive' } },
            { country: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { ransomwareLiveId: true, id: true },
      });
      victims.forEach((v) => {
        ids.push(v.ransomwareLiveId);
        ids.push(v.id);
      });
    } catch { /* ignore */ }

    try {
      // Telegram channel messages: search in content and channelName
      const msgs = await this.prisma.telegramChannelMessage.findMany({
        where: {
          OR: [
            { content: { contains: search, mode: 'insensitive' } },
            { channelName: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true, messageId: true },
      });
      msgs.forEach((m) => {
        ids.push(m.id);
        if (m.messageId) ids.push(m.messageId);
      });
    } catch { /* ignore */ }

    return [...new Set(ids)]; // deduplicate
  }

  private async resolveAlertMessage(
    serviceSource: string,
    incidentId: string,
    eventId: string | null,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      if (serviceSource === 'ransomware-live') {
        const victim = await this.prisma.ransomwareVictimsData.findFirst({
          where: {
            OR: [{ ransomwareLiveId: incidentId }, { id: incidentId }],
          },
        });
        if (!victim) return null;
        const dateStr = victim.discovered.toLocaleString('es-ES', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const lines = [
          '<b>ALERTA: Nuevo Ciberataque Detectado</b> (recuperado de BD)',
          `<b>País:</b> ${victim.country || 'Desconocido'}`,
          `<b>Organización:</b> ${victim.victim}`,
          `<b>Grupo:</b> ${victim.group || 'Desconocido'}`,
          `<b>Fecha:</b> ${dateStr}`,
        ];
        if (victim.description) {
          lines.push(`<b>Descripción:</b> ${victim.description.substring(0, 300)}${victim.description.length > 300 ? '...' : ''}`);
        }
        if (victim.permalink) {
          lines.push(`<a href="${victim.permalink}">Ver más detalles</a>`);
        }
        return lines.join('\n');
      }

      if (serviceSource === 'telegram-channel') {
        const content = payload.content as string | undefined;
        const channelName = payload.channelName as string | undefined;
        if (typeof content === 'string' && content.length > 0) {
          const parts = ['<b>Mensaje de canal (desde payload)</b>'];
          if (channelName) parts.push(`Canal: ${channelName}`);
          parts.push('');
          parts.push(content.length > 800 ? content.substring(0, 800) + '...' : content);
          return parts.join('\n');
        }
        const msg = await this.prisma.telegramChannelMessage.findFirst({
          where: {
            OR: [{ messageId: eventId || incidentId }, { id: incidentId }],
          },
        });
        if (!msg) return null;
        const text = msg.content.length > 800 ? msg.content.substring(0, 800) + '...' : msg.content;
        return [
          '<b>Mensaje de canal (recuperado de BD)</b>',
          `Canal: ${msg.channelName}`,
          `Fecha: ${msg.date.toLocaleString('es-ES')}`,
          '',
          text,
        ].join('\n');
      }

      return null;
    } catch {
      return null;
    }
  }

  async triggerManualCheck() {
    return this.alertProcessor.triggerManualCheck();
  }

  async getAlertsStatus() {
    return this.alertProcessor.getStatus();
  }

  async getTelegramMessages(limit: number = 50) {
    return this.alertProcessor.getChannelMessages(limit);
  }

  async getTelegramChannelStatus() {
    return this.alertProcessor.getChannelStatus();
  }

  private async findSourceByKey(key: AlertSourceKey): Promise<AlertSource> {
    const source = await this.prisma.alertSource.findUnique({
      where: { key },
    });

    if (!source) {
      throw new NotFoundException('Alert source not found');
    }

    return source;
  }

  private async validateVulnSubscriptionSettings(userId: string, settings: unknown) {
    const profileIds = Array.isArray((settings as any)?.profileIds)
      ? ((settings as any).profileIds as string[])
      : [];
    await this.vulnProfiles.validateProfileIds(userId, profileIds);
  }

  private async ensureChannelOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.userNotificationChannel.findFirst({
      where: { id: channelId, userId },
    });

    if (!channel) {
      throw new BadRequestException('El canal seleccionado no pertenece al usuario');
    }
  }

  // Gestión de canales de Telegram monitoreados
  async getMonitoredChannels() {
    return this.prisma.telegramMonitoredChannel.findMany({
      orderBy: { username: 'asc' },
    });
  }

  async createMonitoredChannel(data: { username: string; description?: string }) {
    // Asegurar que el username tenga @
    const username = data.username.startsWith('@') ? data.username : `@${data.username}`;
    
    const channel = await this.prisma.telegramMonitoredChannel.create({
      data: {
        username,
        description: data.description,
        isActive: true,
      },
    });

    // Recargar canales en el servicio de Telegram
    await this.reloadTelegramChannels();
    
    return channel;
  }

  async updateMonitoredChannel(id: string, data: { username?: string; description?: string; isActive?: boolean }) {
    const updateData: any = {};
    
    if (data.username !== undefined) {
      updateData.username = data.username.startsWith('@') ? data.username : `@${data.username}`;
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }

    const channel = await this.prisma.telegramMonitoredChannel.update({
      where: { id },
      data: updateData,
    });

    // Recargar canales en el servicio de Telegram
    await this.reloadTelegramChannels();

    return channel;
  }

  async deleteMonitoredChannel(id: string) {
    await this.prisma.telegramMonitoredChannel.delete({
      where: { id },
    });
    // Recargar canales en el servicio de Telegram
    await this.reloadTelegramChannels();
    return { success: true };
  }

  async reloadTelegramChannels() {
    return this.alertProcessor.reloadTelegramChannels();
  }
}
