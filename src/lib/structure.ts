export type Pair = { source: string; agency: string };
type P = { id: string; name: string };
type L = { external_id: string; external_group: string };
const key = (s: string) => s.trim().toLowerCase();

/**
 * Reproduces Singular's agency <-> source structure as partners + links.
 * - every non-empty agency becomes a partner (matched to an existing partner by exact name, case-insensitive);
 * - every (source, agency) pair becomes a link, unless that exact pair is already linked.
 * Deliberately exact-name only: fuzzy matching could merge two different agencies.
 */
export function planImport(pairs: Pair[], partners: P[], links: L[]) {
  const existing = new Map(partners.map((p) => [key(p.name), p.id]));
  const linked = new Set(links.map((l) => `${l.external_id}|${l.external_group}`));
  const agencies = new Map<string, string>();               // key -> display name (first spelling wins)
  const newPairs: Pair[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    if (!p.agency.trim() || !p.source) continue;            // pairs with no agency cannot become a partner
    const id = `${p.source}|${p.agency}`;
    if (seen.has(id)) continue; seen.add(id);
    if (!agencies.has(key(p.agency))) agencies.set(key(p.agency), p.agency);
    if (!linked.has(id)) newPairs.push(p);
  }
  const toCreate = [...agencies].filter(([k]) => !existing.has(k)).map(([, name]) => name);
  const partnerIdFor = (agency: string) => existing.get(key(agency)) ?? null;
  return { toCreate, partnerIdFor, newPairs, agencyKey: key };
}
