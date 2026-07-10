import { Injectable } from '@nestjs/common';
import axios from 'axios';

export interface TelegramMessage {
  victim: string;
  group?: string;
  country?: string;
  discovered: Date;
  permalink?: string;
  description?: string;
}

@Injectable()
export class TelegramService {
  private readonly baseUrl = 'https://api.telegram.org/bot';

  async sendAlert(
    botToken: string,
    chatId: string,
    incident: TelegramMessage,
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    const message = this.buildIncidentMessage(incident);
    return this.sendHtmlMessage(botToken, chatId, message);
  }

  buildIncidentMessage(incident: TelegramMessage): string {
    return this.formatAlertMessage(incident);
  }

  async sendHtmlMessage(
    botToken: string,
    chatId: string,
    message: string,
    options?: { disablePreview?: boolean },
  ): Promise<{ success: boolean; messageId?: number; error?: string }> {
    try {
      const response = await axios.post(
        `${this.baseUrl}${botToken}/sendMessage`,
        {
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: options?.disablePreview ?? false,
        },
        { timeout: 10000 },
      );

      return { success: true, messageId: response.data.result.message_id };
    } catch (error: any) {
      console.error('Error sending Telegram message:', error.message);
      return { success: false, error: error.message };
    }
  }

  private formatAlertMessage(incident: TelegramMessage): string {
    const countryFlag = this.getCountryFlag(incident.country || '');

    return `
ALERTA: <b>Nuevo Ciberataque Detectado</b>

${countryFlag} <b>País:</b> ${incident.country || 'Desconocido'}
🏢 <b>Organización:</b> ${incident.victim}
🎯 <b>Grupo:</b> ${incident.group || 'Desconocido'}
🕒 <b>Fecha:</b> ${this.formatDate(incident.discovered)}
${incident.description ? `\n📝 <b>Descripción:</b> ${incident.description.substring(0, 200)}${incident.description.length > 200 ? '...' : ''}` : ''}
${incident.permalink ? `\n🔗 <a href="${incident.permalink}">Ver más detalles</a>` : ''}
    `.trim();
  }

  private formatDate(date: Date): string {
    return new Date(date).toLocaleString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getCountryFlag(countryCode: string): string {
    const flags: Record<string, string> = {
      AR: '🇦🇷',
      GB: '🇬🇧',
      US: '🇺🇸',
      MX: '🇲🇽',
      BR: '🇧🇷',
      CL: '🇨🇱',
      CO: '🇨🇴',
      ES: '🇪🇸',
      FR: '🇫🇷',
      DE: '🇩🇪',
      IT: '🇮🇹',
      CA: '🇨🇦',
      AU: '🇦🇺',
      JP: '🇯🇵',
      CN: '🇨🇳',
      IN: '🇮🇳',
      RU: '🇷🇺',
    };
    return flags[countryCode.toUpperCase()] || '🏳️';
  }

  async testConnection(
    botToken: string,
  ): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}${botToken}/getMe`, {
        timeout: 5000,
      });
      return { success: true, botInfo: response.data.result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
