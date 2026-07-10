import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { envs } from 'libs/config/src/envs';

// Decorador para marcar rutas públicas (excluidas del guard)
export const IS_PUBLIC = Symbol('isPublic');
export const Public = () => SetMetadata(IS_PUBLIC, true);

@Injectable()
export class IpWhitelistGuard implements CanActivate {
  private allowedIps: string[];

  constructor(private reflector: Reflector) {
    // Obtener IPs permitidas desde variables de entorno
    const allowedIpsEnv = envs.ALLOWED_IPS || '';
    this.allowedIps = allowedIpsEnv
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);

    // Si no hay IPs configuradas, permitir todas
    if (this.allowedIps.length === 0) {
      console.warn(
        '⚠️  IP Whitelist: No IPs configuradas, permitiendo todas las IPs',
      );
      this.allowedIps = ['*'];
    }

    if (this.allowedIps.length > 0 && !this.allowedIps.includes('*')) {
      console.log(
        `🔒 IP Whitelist activado: ${this.allowedIps.length} IP(s) permitida(s): [${this.allowedIps.join(', ')}]`,
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    // Verificar si la ruta está marcada como pública
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Si está en desarrollo y no hay restricciones, permitir todo
    if (this.allowedIps.includes('*')) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);
    const normalizedClientIp = this.normalizeIp(clientIp);

    // Permitir localhost (IPv4 e IPv6) para healthchecks y solicitudes internas
    if (
      normalizedClientIp === '127.0.0.1' ||
      normalizedClientIp === '::1' ||
      clientIp === '::1'
    ) {
      return true;
    }

    const isAllowed = this.allowedIps.some((allowedIp) => {
      // Normalizar ambas IPs para comparación
      const normalizedAllowedIp = this.normalizeIp(allowedIp);

      // Soporte para rangos CIDR (ej: 192.168.1.0/24)
      if (normalizedAllowedIp.includes('/')) {
        const inCidr = this.isIpInCidr(normalizedClientIp, normalizedAllowedIp);
        return inCidr;
      }
      // Comparación exacta (ambas normalizadas)
      const matches = normalizedClientIp === normalizedAllowedIp;
      return matches;
    });

    if (!isAllowed) {
      console.warn(
        `🚫 Acceso denegado desde IP: ${clientIp} (normalizada: ${normalizedClientIp})`,
      );
      console.warn(`🚫 IPs permitidas: [${this.allowedIps.join(', ')}]`);
      throw new ForbiddenException(
        `Acceso denegado. IP no autorizada: ${clientIp}`,
      );
    }

    return true;
  }

  private getClientIp(request: Request): string {
    // Obtener IP real considerando proxies/load balancers
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      // X-Forwarded-For puede contener múltiples IPs, tomar la primera
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      const ip = ips.split(',')[0].trim();
      return this.normalizeIp(ip);
    }

    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      const ip = Array.isArray(realIp) ? realIp[0] : realIp;
      return this.normalizeIp(ip);
    }

    // Fallback a la IP de la conexión
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    return this.normalizeIp(ip);
  }

  private normalizeIp(ip: string): string {
    // Convertir IPv6 mapeada a IPv4 (::ffff:192.168.1.1 -> 192.168.1.1)
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7); // Remover '::ffff:'
    }
    // Si es IPv6 pura, retornar tal cual (no se puede convertir)
    if (ip.includes(':') && !ip.includes('.')) {
      return ip;
    }
    return ip;
  }

  private isIpInCidr(ip: string, cidr: string): boolean {
    try {
      const [network, prefixLength] = cidr.split('/');
      const mask = parseInt(prefixLength, 10);

      // Normalizar ambas IPs antes de convertir a número
      const normalizedIp = this.normalizeIp(ip);
      const normalizedNetwork = this.normalizeIp(network);

      const ipNum = this.ipToNumber(normalizedIp);
      const networkNum = this.ipToNumber(normalizedNetwork);
      const maskNum = (0xffffffff << (32 - mask)) >>> 0;

      return (ipNum & maskNum) === (networkNum & maskNum);
    } catch {
      return false;
    }
  }

  private ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number);
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }
}
