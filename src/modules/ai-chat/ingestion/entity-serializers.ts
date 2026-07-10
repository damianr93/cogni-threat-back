import type {
  RansomwareGroupsData,
  RansomwareVictimsData,
  VulnCve,
  ActorsData,
  HitosData,
  TelegramChannelMessage,
} from '@prisma/client';

function fmt(d: Date | null | undefined): string {
  if (!d) return '';
  return d instanceof Date
    ? d.toISOString().split('T')[0]
    : String(d).split('T')[0];
}

function lines(...parts: (string | undefined | null | false)[]): string {
  return parts.filter(Boolean).join('\n');
}

// ─── SOURCE ID CONVENTION ──────────────────────────────────────────────────

export const sourceId = {
  ransomwareGroup: (group: string) => `ransomware:group:${group}`,
  ransomwareVictim: (id: string) => `ransomware:victim:${id}`,
  vulnCve: (id: string) => `vuln-monitor:cve:${id}`,
  actor: (id: string) => `actors:actor:${id}`,
  telegramMsg: (id: string) => `telegram:msg:${id}`,
};

// ─── LABEL DERIVATION ──────────────────────────────────────────────────────

const OPAQUE_ID = /^c[a-z0-9]{20,}$/i;

const SUMMARY_LABEL_PATTERNS = [
  /^Actor de amenaza: (.+?)(?:\n|$)/,
  /^Actor: (.+?) \(continuación/,
  /^Víctima ransomware: (.+?)(?:\n|$)/,
  /^Vulnerabilidad: (.+?)(?:\n|$)/,
  /^Canal Telegram: (.+?)(?:\n|$)/,
  /^Grupo ransomware: (.+?)(?:\n|$)/,
];

function labelFromSummary(summary: string): string | null {
  for (const pattern of SUMMARY_LABEL_PATTERNS) {
    const match = summary.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function deriveLabel(source: string, summary?: string): string {
  const tail = source.split(':').pop() || source;
  if (!OPAQUE_ID.test(tail)) return tail;
  if (summary) {
    const parsed = labelFromSummary(summary);
    if (parsed) return parsed;
  }
  return tail;
}

// ─── SERIALIZERS ────────────────────────────────────────────────────────────

export function serializeRansomwareGroup(g: RansomwareGroupsData): string {
  return lines(
    `Grupo ransomware: ${g.group}`,
    g.altname ? `Nombre alternativo: ${g.altname}` : null,
    `Víctimas totales: ${g.victims}`,
    g.description ? `Descripción: ${g.description}` : null,
    g.firstseen ? `Primera actividad: ${fmt(g.firstseen)}` : null,
    g.lastseen ? `Última actividad: ${fmt(g.lastseen)}` : null,
    g.added_date ? `Registrado: ${fmt(g.added_date)}` : null,
    g.ttps && g.ttps.length > 0 ? `TTPs MITRE: ${g.ttps.join(', ')}` : null,
    g.vulnerabilities && g.vulnerabilities.length > 0
      ? `Vulnerabilidades explotadas: ${g.vulnerabilities.join(', ')}`
      : null,
    g.has_negotiations
      ? `Realiza negociaciones: Sí (${g.negotiation_count} registradas)`
      : null,
    g.ransomnotes_count > 0 ? `Notas de rescate: ${g.ransomnotes_count}` : null,
    g.url ? `URL del grupo: ${g.url}` : null,
  );
}

export function serializeRansomwareVictim(v: RansomwareVictimsData): string {
  return lines(
    `Víctima ransomware: ${v.victim}`,
    `Grupo atacante: ${v.group}`,
    v.country ? `País: ${v.country}` : null,
    v.activity ? `Sector: ${v.activity}` : null,
    `Descubierta: ${fmt(v.discovered)}`,
    v.attackDate ? `Fecha del ataque: ${fmt(v.attackDate)}` : null,
    v.description ? `Descripción: ${v.description}` : null,
    v.website ? `Sitio web: ${v.website}` : null,
    v.infostealer ? `Infostealer usado: ${v.infostealer}` : null,
    v.press ? `Prensa: ${v.press}` : null,
  );
}

export function serializeVulnCve(c: VulnCve): string {
  const severity = c.severity ?? 'DESCONOCIDA';
  const cvssScore = c.cvssScore != null ? Number(c.cvssScore).toFixed(1) : null;
  const epssScore = c.epssScore != null ? Number(c.epssScore).toFixed(5) : null;
  const epssPerc =
    c.epssPercentile != null
      ? (Number(c.epssPercentile) * 100).toFixed(1)
      : null;

  let affectedStr = '';
  if (c.affectedPackages) {
    try {
      const pkgs = c.affectedPackages as any[];
      if (Array.isArray(pkgs) && pkgs.length > 0) {
        const top = pkgs
          .slice(0, 5)
          .map((p: any) => `${p.vendor ?? ''}/${p.product ?? ''}`)
          .join(', ');
        affectedStr = `Productos afectados: ${top}${pkgs.length > 5 ? ` (y ${pkgs.length - 5} más)` : ''}`;
      }
    } catch {
      /* ignore */
    }
  }

  return lines(
    `Vulnerabilidad: ${c.cveId ?? c.id}`,
    c.title ? `Título: ${c.title}` : null,
    c.description ? `Descripción: ${c.description}` : null,
    cvssScore
      ? `CVSS Score: ${cvssScore} (${severity}) — ${c.cvssVersion ?? ''}`
      : null,
    c.cvssVector ? `Vector CVSS: ${c.cvssVector}` : null,
    c.isKev
      ? `KEV (Known Exploited Vulnerability): Sí, fecha: ${fmt(c.kevDate)}${c.kevDueDate ? `, vencimiento: ${fmt(c.kevDueDate)}` : ''}`
      : 'KEV: No',
    c.kevRansomware ? 'Usado en ataques ransomware: Sí' : null,
    epssScore ? `EPSS Score: ${epssScore} (percentil ${epssPerc}%)` : null,
    c.publishedAt ? `Publicado: ${fmt(c.publishedAt)}` : null,
    c.modifiedAt ? `Última modificación: ${fmt(c.modifiedAt)}` : null,
    c.sources && c.sources.length > 0
      ? `Fuentes de datos: ${c.sources.join(', ')}`
      : null,
    affectedStr || null,
  );
}

export function serializeActor(
  a: ActorsData & { hitosDatas: HitosData[] },
): string[] {
  const header = lines(
    `Actor de amenaza: ${a.name}`,
    a.aliases && a.aliases.length > 0
      ? `Aliases: ${a.aliases.join(', ')}`
      : null,
    a.country ? `País de origen: ${a.country}` : null,
    a.identificatedDate ? `Identificado: ${fmt(a.identificatedDate)}` : null,
    a.description ? `Descripción: ${a.description}` : null,
    a.descriptionMethods
      ? `Descripción de métodos: ${a.descriptionMethods}`
      : null,
    a.methods && a.methods.length > 0
      ? `Técnicas/métodos: ${a.methods.join(', ')}`
      : null,
  );

  if (a.hitosDatas.length === 0) return [header];

  // Agrupa hitos: hasta 8 por chunk para mantener tamaño manejable
  const HITOS_PER_CHUNK = 8;
  const chunks: string[] = [];

  for (let i = 0; i < a.hitosDatas.length; i += HITOS_PER_CHUNK) {
    const slice = a.hitosDatas.slice(i, i + HITOS_PER_CHUNK);
    const hitosStr = slice
      .map((h) =>
        lines(
          `  - ${fmt(h.date)}: ${h.description}`,
          `    Objetivo: ${h.target}`,
          h.link ? `    Link: ${h.link}` : null,
        ),
      )
      .join('\n');

    const prefix = i === 0 ? header : `Actor: ${a.name} (continuación hitos)`;
    chunks.push(`${prefix}\nHitos:\n${hitosStr}`);
  }

  return chunks;
}

export function serializeTelegramMessage(m: TelegramChannelMessage): string {
  return lines(
    `Canal Telegram: ${m.channelName}`,
    `Fecha: ${fmt(m.date)}`,
    `Mensaje: ${m.content}`,
  );
}
