import type {
  CveMatchInput,
  ProfileInput,
  ProfileMatchHit,
  ProfileMatchResult,
} from './vuln-alert.types';
import {
  extractCveMatchSurface,
  normalizeToken,
  tokenMatchesQuery,
} from './cve-match-surface';

export function matchCveToProfiles(
  cve: CveMatchInput,
  profiles: ProfileInput[],
): ProfileMatchResult {
  const surface = extractCveMatchSurface(cve);
  const hits: ProfileMatchHit[] = [];

  for (const profile of profiles) {
    for (const item of profile.items) {
      const matchedOn = matchItem(surface, item);
      if (!matchedOn) continue;
      hits.push({
        profileId: profile.id,
        profileName: profile.name,
        environment: profile.environment,
        itemId: item.id,
        itemLabel: item.label,
        matchedOn,
      });
    }
  }

  return { matched: hits.length > 0, hits };
}

function matchItem(
  surface: ReturnType<typeof extractCveMatchSurface>,
  item: ProfileInput['items'][number],
): string | null {
  const vendor = item.vendor ? normalizeToken(item.vendor) : null;
  const product = item.product ? normalizeToken(item.product) : null;
  const ecosystem = item.ecosystem ? normalizeToken(item.ecosystem) : null;
  const query = normalizeToken(item.query);

  if (vendor && product) {
    const vendorProduct = `${vendor}-${product}`;
    if (surface.haystack.includes(vendorProduct)) return vendorProduct;
    if (
      surface.haystack.includes(vendor) &&
      surface.haystack.includes(product)
    ) {
      return `${vendor}+${product}`;
    }
    return null;
  }

  if (ecosystem && query) {
    for (const entry of surface.packageEntries) {
      if (entry.ecosystem !== ecosystem) continue;
      if (entry.name.includes(query) || entry.combined.includes(query)) {
        return entry.combined;
      }
    }
    return null;
  }

  if (query && tokenMatchesQuery(surface.haystack, query)) {
    return query;
  }

  return null;
}
