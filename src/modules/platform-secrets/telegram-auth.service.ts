import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import { SecretsService } from '../../shared/secret-store/secrets.service';
import { TelegramChannelService } from '../alerts/telegram-channel.service';

const PENDING_TTL_MS = 5 * 60 * 1000;

interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  updatedBy?: string;
  createdAt: number;
}

/**
 * Drives the interactive MTProto login (phone → code → optional 2FA) over HTTP.
 *
 * Holds a single in-memory "pending" client, deliberately separate from the
 * monitoring client in TelegramChannelService — the monitoring watchdog forces
 * a reconnect every 5 min and would otherwise destroy a mid-login client.
 * Admin-only, single session ⇒ one pending login at a time.
 */
@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);
  private pending: PendingLogin | null = null;

  constructor(
    private readonly secrets: SecretsService,
    private readonly telegramChannel: TelegramChannelService,
  ) {}

  async startLogin(phone: string, updatedBy?: string) {
    if (!phone || !/^\+?\d{6,15}$/.test(phone.trim())) {
      throw new BadRequestException('Invalid phone number');
    }
    if (!this.secrets.storeEnabled) {
      throw new BadRequestException(
        'Secret store disabled: SECRETS_MASTER_KEY not configured',
      );
    }

    const apiId = parseInt((await this.secrets.get('telegram_api_id')) || '0');
    const apiHash = (await this.secrets.get('telegram_api_hash')) || '';
    if (!apiId || !apiHash) {
      throw new BadRequestException(
        'Configure Telegram API ID and API Hash before logging in',
      );
    }

    await this.discardPending();

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 3,
    });
    await client.connect();

    const { phoneCodeHash } = await client.sendCode(
      { apiId, apiHash },
      phone.trim(),
    );
    this.pending = {
      client,
      phone: phone.trim(),
      phoneCodeHash,
      updatedBy,
      createdAt: Date.now(),
    };
    this.logger.log('Telegram login code requested');
    return { codeSent: true };
  }

  async verifyCode(code: string) {
    const pending = this.requirePending();
    if (!code || code.trim().length === 0) {
      throw new BadRequestException('Verification code is required');
    }

    try {
      await pending.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: pending.phone,
          phoneCodeHash: pending.phoneCodeHash,
          phoneCode: code.trim(),
        }),
      );
    } catch (err: any) {
      const reason = err?.errorMessage || err?.message || '';
      if (reason.includes('SESSION_PASSWORD_NEEDED')) {
        return { passwordRequired: true };
      }
      await this.discardPending();
      throw new BadRequestException(`Telegram sign-in failed: ${reason}`);
    }

    return this.finish();
  }

  async submitPassword(password: string) {
    const pending = this.requirePending();
    if (!password) {
      throw new BadRequestException('2FA password is required');
    }

    try {
      const passwordInfo = await pending.client.invoke(
        new Api.account.GetPassword(),
      );
      const check = await computeCheck(passwordInfo, password);
      await pending.client.invoke(
        new Api.auth.CheckPassword({ password: check }),
      );
    } catch (err: any) {
      const reason = err?.errorMessage || err?.message || '';
      await this.discardPending();
      throw new BadRequestException(`Telegram 2FA failed: ${reason}`);
    }

    return this.finish();
  }

  getConnectionStatus() {
    return {
      ...this.telegramChannel.getConnectionStatus(),
      pendingLogin: this.pending !== null,
    };
  }

  private async finish() {
    const pending = this.requirePending();
    const session = pending.client.session.save() as unknown as string;
    await this.secrets.set(
      'telegram_session_string',
      session,
      pending.updatedBy,
    );

    try {
      await pending.client.disconnect();
    } catch {
      /* ignore */
    }
    this.pending = null;

    this.logger.log('Telegram session stored; restarting monitoring');
    await this.telegramChannel.restartWithFreshSession();
    return { success: true, connected: true };
  }

  private requirePending(): PendingLogin {
    if (!this.pending) {
      throw new BadRequestException(
        'No pending Telegram login. Start the login flow first.',
      );
    }
    if (Date.now() - this.pending.createdAt > PENDING_TTL_MS) {
      void this.discardPending();
      throw new BadRequestException(
        'Login session expired. Start the login flow again.',
      );
    }
    return this.pending;
  }

  private async discardPending() {
    if (this.pending) {
      try {
        await this.pending.client.disconnect();
      } catch {
        /* ignore */
      }
      this.pending = null;
    }
  }
}
