import { ToolCall } from '../types/chat.types';

const MAX_CALLS = 3;
const MAX_KEYWORDS = 6;
const CVE_ID = /cve-\d{4}-\d{4,}/g;

const STOPWORDS = new Set(
  (
    'de del la las los el un una unos unas en con sobre para por que como cual cuales cuantos cuantas ' +
    'hay son es se me te mas ultimas ultimos ultima ultimo recientes reciente dame dime muestrame mostrar ' +
    'lista listar busca buscar afectan afectando afectan afecta affecting affect affects the and for with about ' +
    'show list find what which are from last latest recent any all give tell'
  ).split(' '),
);

const DOMAIN_WORDS = new Set(
  (
    'cve cves vulnerabilidad vulnerabilidades vulnerability vulnerabilities kev epss cvss ransomware ' +
    'victima victimas victim victims atacadas atacados grupo grupos group groups actor actores actors apt ' +
    'telegram canal canales channel mensaje mensajes message messages'
  ).split(' '),
);

export type RouterCall = ToolCall;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function keywordsOf(norm: string): string[] {
  const tokens = norm
    .replace(/@[\w]+/g, ' ')
    .match(/[a-z0-9][a-z0-9._+-]{2,}/g);
  return (tokens ?? [])
    .filter(
      (t) => !STOPWORDS.has(t) && !DOMAIN_WORDS.has(t) && !t.startsWith('cve-'),
    )
    .slice(0, MAX_KEYWORDS);
}

/**
 * Deterministic intent detection (accent-stripped, fixed order, at most 3
 * calls). An empty result means "no data question recognised".
 */
export function detectIntents(question: string): RouterCall[] {
  const norm = normalize(question);
  const keywords = keywordsOf(norm);
  const first = keywords[0];
  const calls: RouterCall[] = [];

  const ids = [...new Set(norm.match(CVE_ID) ?? [])];
  for (const id of ids) {
    calls.push({ name: 'get_cve', arguments: { cveId: id.toUpperCase() } });
  }

  if (/telegram|\bcanal(es)?\b|\bchannel\b|@\w+/.test(norm)) {
    const channel = norm.match(/@(\w+)/)?.[1];
    calls.push({
      name: 'search_telegram_messages',
      arguments: {
        ...(keywords.length ? { keywords } : {}),
        ...(channel ? { channel } : {}),
        ...(!keywords.length && !channel
          ? { query: question.slice(0, 200) }
          : {}),
      },
    });
  }

  const group = norm.match(
    /\b(?:grupo|group)\s+(?:ransomware\s+)?(?!apt\b|de\b|ransomware\b)([a-z0-9._-]{3,})/,
  )?.[1];
  if (group) {
    calls.push({ name: 'get_ransomware_group', arguments: { name: group } });
  } else if (/ransom|victim|atacad|filtracion/.test(norm)) {
    calls.push({
      name: 'search_ransomware_victims',
      arguments: first ? { query: first } : {},
    });
  }

  if (!ids.length && /\bcves?\b|vulnerab|\bkev\b|epss|cvss/.test(norm)) {
    calls.push({
      name: 'search_cves',
      arguments: {
        ...(first ? { query: first } : {}),
        ...(/\bkev\b/.test(norm) ? { isKev: true } : {}),
      },
    });
  }

  if (/\bapt\d*\b|\bactor(es)?\b/.test(norm)) {
    calls.push({
      name: 'search_actors',
      arguments: first ? { query: first } : {},
    });
  }

  return calls.slice(0, MAX_CALLS);
}
