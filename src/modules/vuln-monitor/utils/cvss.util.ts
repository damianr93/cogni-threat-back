/**
 * CVSS base score parsing.
 *
 * Feeds such as OSV publish only the vector string, never the numeric score, so
 * the score has to be recomputed locally before a severity can be assigned.
 *
 * CVSS 2.0, 3.0 and 3.1 base scores are implemented exactly as specified.
 * CVSS 4.0 is recognised but deliberately NOT scored: its base score comes from
 * a MacroVector lookup table, and an approximation would write wrong severities
 * into the threat database. Those records keep a null score and stay visible
 * through the KEV/unknown paths instead.
 */

export interface ParsedCvss {
  version: string | null;
  score: number | null;
}

type MetricMap = Record<string, string>;

const V3_WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
  // Privileges Required is weighted differently once scope changes.
  PR_UNCHANGED: { N: 0.85, L: 0.62, H: 0.27 },
  PR_CHANGED: { N: 0.85, L: 0.68, H: 0.5 },
} as const;

const V2_WEIGHTS = {
  AV: { L: 0.395, A: 0.646, N: 1.0 },
  AC: { H: 0.35, M: 0.61, L: 0.71 },
  Au: { M: 0.45, S: 0.56, N: 0.704 },
  CIA: { N: 0, P: 0.275, C: 0.66 },
} as const;

export function parseCvssVector(vector: string | null | undefined): ParsedCvss {
  if (typeof vector !== 'string' || !vector.trim())
    return { version: null, score: null };

  const raw = vector.trim();
  const metrics = toMetricMap(raw);

  if (raw.startsWith('CVSS:4.0')) return { version: '4.0', score: null };
  if (raw.startsWith('CVSS:3.1'))
    return { version: '3.1', score: scoreV3(metrics, '3.1') };
  if (raw.startsWith('CVSS:3.0'))
    return { version: '3.0', score: scoreV3(metrics, '3.0') };

  // CVSS 2.0 vectors carry no version prefix; they are identified by Au.
  if (metrics.Au && metrics.AV && metrics.AC)
    return { version: '2.0', score: scoreV2(metrics) };

  return { version: null, score: null };
}

export function severityFromScore(
  score: number | null | undefined,
  version: string | null | undefined,
): string | null {
  if (score == null || Number.isNaN(score)) return null;

  // CVSS 2.0 has no CRITICAL band.
  if (version === '2.0') {
    if (score >= 7) return 'HIGH';
    if (score >= 4) return 'MEDIUM';
    return 'LOW';
  }

  if (score >= 9) return 'CRITICAL';
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'NONE';
}

const SEVERITY_LABELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
// GitHub-reviewed advisories use MODERATE where CVSS uses MEDIUM.
const SEVERITY_LABEL_ALIASES: Record<string, string> = { MODERATE: 'MEDIUM' };

export interface OsvSeverityResolution {
  cvssScore: number | null;
  cvssVector: string | null;
  cvssVersion: string | null;
  severity: string | null;
}

/** Normalises an advisory severity label, or returns null when unknown. */
export function normalizeSeverityLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  const label = SEVERITY_LABEL_ALIASES[upper] ?? upper;
  return SEVERITY_LABELS.includes(label) ? label : null;
}

/**
 * Resolves CVSS data from an OSV `severity` array and the advisory's
 * `database_specific.severity` label. A scored 3.1 vector wins, then any
 * scored vector, then the first recognised vector (kept for visibility, e.g.
 * CVSS 4.0, which is not scored). The label is the fallback when no score is
 * available.
 */
export function resolveOsvSeverity(
  severities: unknown,
  label: unknown,
): OsvSeverityResolution {
  const entries: Array<{ score?: unknown } | null> = Array.isArray(severities)
    ? (severities as Array<{ score?: unknown } | null>)
    : [];
  const parsed = entries
    .map((entry) => entry?.score)
    .filter((score): score is string => typeof score === 'string')
    .map((vector) => ({ vector, ...parseCvssVector(vector) }))
    .filter((entry) => entry.version !== null);

  const best =
    parsed.find((e) => e.score !== null && e.version === '3.1') ??
    parsed.find((e) => e.score !== null) ??
    parsed[0] ??
    null;

  return {
    cvssScore: best?.score ?? null,
    cvssVector: best?.vector ?? null,
    cvssVersion: best?.version ?? null,
    severity:
      severityFromScore(best?.score, best?.version) ??
      normalizeSeverityLabel(label),
  };
}

function toMetricMap(vector: string): MetricMap {
  const metrics: MetricMap = {};
  for (const part of vector.split('/')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    metrics[part.substring(0, idx)] = part.substring(idx + 1);
  }
  return metrics;
}

function scoreV3(metrics: MetricMap, version: '3.0' | '3.1'): number | null {
  const scopeChanged = metrics.S === 'C';
  if (metrics.S !== 'C' && metrics.S !== 'U') return null;

  const av = pick(V3_WEIGHTS.AV, metrics.AV);
  const ac = pick(V3_WEIGHTS.AC, metrics.AC);
  const ui = pick(V3_WEIGHTS.UI, metrics.UI);
  const pr = pick(
    scopeChanged ? V3_WEIGHTS.PR_CHANGED : V3_WEIGHTS.PR_UNCHANGED,
    metrics.PR,
  );
  const c = pick(V3_WEIGHTS.CIA, metrics.C);
  const i = pick(V3_WEIGHTS.CIA, metrics.I);
  const a = pick(V3_WEIGHTS.CIA, metrics.A);

  if ([av, ac, ui, pr, c, i, a].some((v) => v === null)) return null;

  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;

  if (impact <= 0) return 0;

  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  const base = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  return version === '3.1' ? roundUp31(base) : roundUpDecimal(base);
}

function scoreV2(metrics: MetricMap): number | null {
  const av = pick(V2_WEIGHTS.AV, metrics.AV);
  const ac = pick(V2_WEIGHTS.AC, metrics.AC);
  const au = pick(V2_WEIGHTS.Au, metrics.Au);
  const c = pick(V2_WEIGHTS.CIA, metrics.C);
  const i = pick(V2_WEIGHTS.CIA, metrics.I);
  const a = pick(V2_WEIGHTS.CIA, metrics.A);

  if ([av, ac, au, c, i, a].some((v) => v === null)) return null;

  const impact = 10.41 * (1 - (1 - c!) * (1 - i!) * (1 - a!));
  const exploitability = 20 * av! * ac! * au!;
  const fImpact = impact === 0 ? 0 : 1.176;
  const base = (0.6 * impact + 0.4 * exploitability - 1.5) * fImpact;

  return Math.round(base * 10) / 10;
}

function pick(
  table: Record<string, number>,
  key: string | undefined,
): number | null {
  if (!key) return null;
  return key in table ? table[key] : null;
}

/**
 * CVSS 3.1 defines roundup over integer arithmetic to avoid float drift
 * (e.g. 4.02 must round to 4.1, but a value that is 4.000000001 from float
 * error must stay 4.0).
 */
function roundUp31(value: number): number {
  const scaled = Math.round(value * 100000);
  if (scaled % 10000 === 0) return scaled / 100000;
  return (Math.floor(scaled / 10000) + 1) / 10;
}

function roundUpDecimal(value: number): number {
  return Math.ceil(Math.round(value * 100000) / 10000) / 10;
}
