import type { ProfileMatchHit } from './vuln-alert.types';

export function buildVulnTelegramMessage(params: {
  cveId: string;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
  cvssScore?: string;
  epssScore?: string | null;
  epssPercentile?: string | null;
  isKev: boolean;
  kevRansomware?: boolean;
  sourceBadges: string;
  hits: ProfileMatchHit[];
  affectedPackages?: unknown;
  nvdLink?: string | null;
  dashboardLink?: string | null;
  escapeHtml: (value: string) => string;
  truncate: (value: string, max: number) => string;
}): string {
  const lines: string[] = [];

  if (params.isKev) {
    lines.push('<b>🚨 CVE EN CISA KEV — MATCH DE INVENTARIO</b>');
  } else {
    lines.push('<b>⚠️ CVE EN TU INVENTARIO</b>');
  }

  lines.push(`<b>CVE:</b> ${params.escapeHtml(params.cveId)}`);
  if (params.title) lines.push(`<b>Título:</b> ${params.escapeHtml(params.title)}`);

  const profileLines = groupHitsByProfile(params.hits);
  lines.push('<b>Perfiles:</b>');
  for (const pl of profileLines) {
    lines.push(`• ${params.escapeHtml(pl)}`);
  }

  lines.push(`<b>Severidad:</b> ${params.escapeHtml(params.severity ?? 'UNKNOWN')} (CVSS ${params.cvssScore})`);
  if (params.epssScore) {
    lines.push(`<b>EPSS:</b> ${params.epssScore} (${params.epssPercentile}% percentil)`);
  }
  if (params.kevRansomware) lines.push('<b>Ransomware:</b> Confirmado en KEV');
  lines.push(`<b>Fuentes:</b> ${params.sourceBadges}`);

  const pkgSummary = summarizePackages(params.affectedPackages);
  if (pkgSummary) lines.push(`<b>Afecta:</b> ${params.escapeHtml(pkgSummary)}`);

  if (params.description) {
    lines.push(`<b>Descripción:</b> ${params.escapeHtml(params.truncate(params.description, 200))}...`);
  }

  const links: string[] = [];
  if (params.nvdLink) links.push(`<a href="${params.nvdLink}">NVD</a>`);
  if (params.dashboardLink) links.push(`<a href="${params.dashboardLink}">Dashboard</a>`);
  if (links.length) lines.push(`\n🔗 ${links.join(' · ')}`);

  return lines.join('\n');
}

function groupHitsByProfile(hits: ProfileMatchHit[]): string[] {
  const map = new Map<string, string[]>();
  for (const hit of hits) {
    const env = hit.environment ? `[${hit.environment}] ` : '';
    const key = `${env}${hit.profileName}`;
    const list = map.get(key) ?? [];
    list.push(`${hit.itemLabel} (${hit.matchedOn})`);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([profile, items]) => `${profile}: ${items.join(', ')}`);
}

function summarizePackages(affectedPackages: unknown): string | null {
  if (!Array.isArray(affectedPackages) || affectedPackages.length === 0) return null;
  const top = affectedPackages.slice(0, 3).map((p: any) => {
    const eco = p?.ecosystem ? `${p.ecosystem}/` : '';
    return `${eco}${p?.name ?? 'unknown'}`;
  });
  const suffix = affectedPackages.length > 3 ? ` (+${affectedPackages.length - 3})` : '';
  return top.join(', ') + suffix;
}
