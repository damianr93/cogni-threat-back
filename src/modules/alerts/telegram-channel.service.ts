import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { envs } from 'libs/config/src/envs';
import { SecretsService } from '../../shared/secret-store/secrets.service';

const WATCHDOG_INTERVAL_MS = 90 * 1000; // 90 segundos
const HEARTBEAT_TIMEOUT_MS = 15 * 1000; // 15 segundos para getMe()
const FORCE_RECONNECT_INTERVAL_MS = 5 * 60 * 1000; // 5 min: reconexión forzada para refrescar stream de updates (MTProto a veces deja de enviar eventos)

@Injectable()
export class TelegramChannelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramChannelService.name);
  private client: TelegramClient;
  private isConnected = false;
  private channelUsernames: string[] = [];
  private channelIds: Map<string, string> = new Map();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private isReconnecting = false;
  private lastForceReconnectAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  async onModuleInit() {
    // Arrancar en background para no bloquear app.listen()
    setImmediate(() => this.initialize());
  }

  private async initialize() {
    // Solo iniciar si está configurado
    const missingConfig: string[] = [];
    if (!(await this.secrets.get('telegram_api_id')))
      missingConfig.push('TELEGRAM_API_ID');
    if (!(await this.secrets.get('telegram_api_hash')))
      missingConfig.push('TELEGRAM_API_HASH');

    if (missingConfig.length > 0) {
      this.logger.warn(
        `⚠️  Telegram channel monitoring not configured. Missing: ${missingConfig.join(', ')}. Skipping initialization.`,
      );
      return;
    }

    // Cargar canales desde la base de datos
    await this.loadChannelsFromDatabase();

    if (this.channelUsernames.length === 0) {
      this.logger.warn(
        '⚠️  No Telegram channels configured in database. Skipping initialization.',
      );
      return;
    }

    try {
      await this.connect();
      if (this.isConnected) {
        await this.startListening();
        this.lastForceReconnectAt = Date.now();
        this.startConnectionWatchdog();
      }
    } catch (error) {
      this.logger.error('Failed to initialize Telegram channel service', error);
    }
  }

  private async loadChannelsFromDatabase() {
    try {
      const channels = await this.prisma.telegramMonitoredChannel.findMany({
        where: { isActive: true },
      });

      this.channelUsernames = channels.map((ch) => ch.username);

      if (this.channelUsernames.length > 0) {
        this.logger.log(
          `📡 Loaded ${this.channelUsernames.length} channels from database: ${this.channelUsernames.join(', ')}`,
        );
      }

      // También cargar de .env como fallback/complemento
      const envChannels = (envs.TELEGRAM_CHANNEL_USERNAME || '')
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (envChannels.length > 0) {
        this.logger.log(
          `📡 Also loading ${envChannels.length} channels from .env as fallback`,
        );
        // Agregar solo los que no estén ya en la lista
        envChannels.forEach((ch) => {
          if (!this.channelUsernames.includes(ch)) {
            this.channelUsernames.push(ch);
          }
        });
      }
    } catch (error) {
      this.logger.error('Error loading channels from database:', error);
      // Fallback a .env si falla la carga de BD
      const envChannels = (envs.TELEGRAM_CHANNEL_USERNAME || '')
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      this.channelUsernames = envChannels;
    }
  }

  async reloadChannels() {
    this.logger.log('🔄 Reloading Telegram channels...');
    const oldChannels = [...this.channelUsernames];
    await this.loadChannelsFromDatabase();

    if (
      JSON.stringify(oldChannels.sort()) !==
      JSON.stringify(this.channelUsernames.sort())
    ) {
      this.logger.log('✅ Channels updated. Restarting listener...');

      await this.ensureDisconnected();
      this.logger.log('🔌 Disconnected to clear old event handlers');

      if (this.channelUsernames.length > 0) {
        try {
          await this.connect();
          if (this.isConnected) {
            await this.startListening();
            this.logger.log('✅ Telegram listener restarted with new channels');
          }
        } catch (error) {
          this.logger.error('Error restarting Telegram listener:', error);
        }
      } else {
        this.logger.log('ℹ️  No channels to monitor, listener stopped');
      }
    } else {
      this.logger.log('ℹ️  No changes in channels list');
    }
  }

  async onModuleDestroy() {
    this.stopConnectionWatchdog();
    await this.ensureDisconnected();
    this.logger.log('Telegram channel service destroyed');
  }

  /**
   * Forces a clean restart of the monitoring client so it picks up a freshly
   * stored session (e.g. after an admin completes the panel login flow).
   */
  async restartWithFreshSession() {
    this.logger.log(
      '🔄 Applying new Telegram session, restarting monitoring...',
    );
    this.stopConnectionWatchdog();
    await this.ensureDisconnected();
    await this.initialize();
  }

  private startConnectionWatchdog() {
    this.stopConnectionWatchdog();
    this.watchdogTimer = setInterval(() => {
      this.checkConnectionAndReconnectIfNeeded().catch((err) =>
        this.logger.error('Watchdog error', err),
      );
    }, WATCHDOG_INTERVAL_MS);
    this.logger.log(
      `🔄 Connection watchdog started (every ${WATCHDOG_INTERVAL_MS / 1000}s)`,
    );
  }

  private stopConnectionWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
      this.logger.log('Connection watchdog stopped');
    }
  }

  private async ensureDisconnected() {
    if (!this.client) {
      this.isConnected = false;
      return;
    }
    try {
      // destroy() sets _destroyed=true which stops _updateLoop, then disconnects.
      // disconnect() alone leaves _destroyed=false, causing a zombie update loop.
      await this.client.destroy();
    } catch (e) {
      this.logger.warn(
        'Error during destroy (ignored):',
        (e as Error)?.message,
      );
    }
    this.client = null as unknown as TelegramClient;
    this.isConnected = false;
    this.channelIds.clear();
  }

  private async checkConnectionAndReconnectIfNeeded() {
    if (this.isReconnecting || this.channelUsernames.length === 0) return;

    const now = Date.now();
    const timeSinceLastForceReconnect = now - this.lastForceReconnectAt;

    // Reconexión forzada periódica: MTProto a veces deja de enviar NewMessage aunque la conexión siga "viva"
    if (timeSinceLastForceReconnect >= FORCE_RECONNECT_INTERVAL_MS) {
      this.logger.log(
        `🔄 Watchdog: forcing reconnect to refresh updates stream (every ${FORCE_RECONNECT_INTERVAL_MS / 60000} min)`,
      );
      this.lastForceReconnectAt = now;
      await this.reconnect();
      return;
    }

    if (!this.client) {
      this.logger.warn('Watchdog: client is null, attempting reconnect...');
      await this.reconnect();
      return;
    }
    if (!this.client.connected) {
      this.logger.warn(
        'Watchdog: client.connected is false, attempting reconnect...',
      );
      await this.reconnect();
      return;
    }
    // Heartbeat: force a round-trip to detect stale/broken connections
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Heartbeat timeout')),
          HEARTBEAT_TIMEOUT_MS,
        ),
      );
      await Promise.race([this.client.getMe(), timeout]);
    } catch (e) {
      this.logger.warn(
        'Watchdog: heartbeat failed, attempting reconnect...',
        (e as Error)?.message,
      );
      await this.reconnect();
    }
  }

  private async reconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    try {
      await this.ensureDisconnected();
      await this.connect();
      if (this.isConnected) {
        await this.startListening();
        this.lastForceReconnectAt = Date.now();
        this.logger.log('✅ Telegram reconnected and listening again');
      }
    } catch (error) {
      this.logger.error(
        'Reconnection failed (will retry on next watchdog run):',
        error,
      );
    } finally {
      this.isReconnecting = false;
    }
  }

  private async connect() {
    try {
      const apiId = parseInt(
        (await this.secrets.get('telegram_api_id')) || '0',
      );
      const apiHash = (await this.secrets.get('telegram_api_hash')) || '';
      const sessionString =
        (await this.secrets.get('telegram_session_string')) || '';
      const stringSession = new StringSession(sessionString);

      this.client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
      });

      await this.client.connect();

      if (!(await this.client.isUserAuthorized())) {
        this.logger.warn(
          '⚠️  Telegram client not authorized. Configure it from the admin panel (Telegram login).',
        );
        return;
      }

      this.isConnected = true;
      this.logger.log('✅ Connected to Telegram via MTProto');

      // Persist the refreshed session so it survives restarts without manual steps.
      const currentSession = this.client.session.save() as unknown as string;
      if (
        currentSession &&
        currentSession !== sessionString &&
        this.secrets.storeEnabled
      ) {
        try {
          await this.secrets.set(
            'telegram_session_string',
            currentSession,
            'telegram-auto-refresh',
          );
          this.logger.log(
            '📝 Telegram session string refreshed and persisted.',
          );
        } catch (e) {
          this.logger.warn(
            'Could not persist refreshed Telegram session:',
            (e as Error)?.message,
          );
        }
      }
    } catch (error) {
      this.logger.error('❌ Error connecting to Telegram:', error);
      throw error;
    }
  }

  private async startListening() {
    if (!this.isConnected) {
      this.logger.warn('Client not connected, cannot start listening');
      return;
    }

    try {
      // Limpiar el Map antes de recargar (por seguridad)
      this.channelIds.clear();

      // Obtener las entidades de todos los canales
      for (const username of this.channelUsernames) {
        try {
          const channel: any = await this.client.getEntity(username);
          const channelId = channel.id?.toString();

          if (channelId) {
            this.channelIds.set(channelId, username);
            this.logger.log(`✅ Found channel: ${username} (ID: ${channelId})`);
          }
        } catch (error) {
          this.logger.error(
            `❌ Failed to find channel: ${username}`,
            error.message,
          );
        }
      }

      if (this.channelIds.size === 0) {
        this.logger.warn('No channels found to monitor');
        return;
      }

      // Escuchar SOLO mensajes de los canales configurados
      this.client.addEventHandler(async (event: any) => {
        try {
          const message = event.message;

          // Filtro: verificar que sea de uno de nuestros canales
          if (!message || !message.message) return;

          const chatId = message.peerId?.channelId?.toString();
          const channelUsername = this.channelIds.get(chatId);

          if (!channelUsername) {
            // Mensaje de otro chat o canal eliminado, ignorar silenciosamente
            return;
          }

          await this.processNewMessage(message, channelUsername);
        } catch (error) {
          // Solo loggear errores reales, no de filtrado
          if (
            error?.message &&
            !error.message.includes('Cannot find any entity')
          ) {
            this.logger.error('Error processing message:', error);
          }
        }
      }, new NewMessage({}));

      this.logger.log(
        `👂 Listening to ${this.channelIds.size} channel(s): ${Array.from(this.channelIds.values()).join(', ')}`,
      );

      // Obtener mensajes recientes de todos los canales
      await this.fetchRecentMessages();
    } catch (error) {
      this.logger.error('Error starting listener:', error);
    }
  }

  private async processNewMessage(message: any, channelUsername: string) {
    try {
      const messageText = message.message || '';
      const messageDate = new Date(message.date * 1000);
      const messageId = message.id?.toString();
      const channelId = message.peerId?.channelId?.toString();

      if (!messageText || !messageId) {
        return;
      }

      // Verificar si ya existe (usar messageId + channelId como clave única)
      const uniqueKey = `${channelId}_${messageId}`;
      const existing = await this.prisma.telegramChannelMessage.findFirst({
        where: {
          messageId: uniqueKey,
        },
      });

      if (existing) {
        return;
      }

      // Guardar en base de datos
      await this.prisma.telegramChannelMessage.create({
        data: {
          channelName: channelUsername,
          content: messageText,
          date: messageDate,
          messageId: uniqueKey,
          channelId: channelId,
        },
      });

      this.logger.log(
        `💾 Saved message from ${channelUsername}: ${messageText.substring(0, 60)}...`,
      );
    } catch (error) {
      this.logger.error('Error saving message:', error);
    }
  }

  private async fetchRecentMessages() {
    try {
      this.logger.log(
        `📥 Fetching recent messages from ${this.channelUsernames.length} channel(s)...`,
      );

      let totalSaved = 0;

      for (const username of this.channelUsernames) {
        try {
          const messages = await this.client.getMessages(username, {
            limit: 100,
          });

          let savedCount = 0;

          for (const message of messages) {
            if ((message as any).message) {
              await this.processNewMessage(message, username);
              savedCount++;
            }
          }

          this.logger.log(
            `✅ Processed ${savedCount} messages from ${username}`,
          );
          totalSaved += savedCount;
        } catch (error) {
          this.logger.error(
            `Error fetching messages from ${username}:`,
            error.message,
          );
        }
      }

      this.logger.log(
        `✅ Total processed: ${totalSaved} messages from all channels`,
      );
    } catch (error) {
      this.logger.error('Error fetching recent messages:', error);
    }
  }

  async getMessages(limit: number = 50) {
    try {
      const messages = await this.prisma.telegramChannelMessage.findMany({
        take: limit,
        orderBy: { date: 'desc' },
      });
      return { success: true, data: messages };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getMessagesByChannel(channelName: string, limit: number = 50) {
    try {
      const messages = await this.prisma.telegramChannelMessage.findMany({
        where: { channelName },
        take: limit,
        orderBy: { date: 'desc' },
      });
      return { success: true, data: messages };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      channels: this.channelUsernames,
      monitoringCount: this.channelIds.size,
    };
  }
}
