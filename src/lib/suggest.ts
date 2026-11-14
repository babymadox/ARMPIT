const NOISE = /\b(ltd|limited|llc|inc|gmbh|media|group|tech|technology|technologies|digital|network|networks|affiliates?|partners?)\b/g;
export const norm = (s: string) => s.toLowerCase().replace(NOISE, " ").replace(/[^a-z0-9]/g, "");

/** Suggests a partner for a tracker source by name: exact normalised match first, then one containing the other (min 4 chars). */
export function suggestPartner<P extends { id: string; name: string }>(source: string, partners: P[]): P | null {
  const s = norm(source);
  if (s.length < 3) return null;
  const exact = partners.find((p) => norm(p.name) === s);
  if (exact) return exact;
  const loose = partners.filter((p) => { const n = norm(p.name); return n.length >= 4 && s.length >= 4 && (n.includes(s) || s.includes(n)); });
  return loose.length === 1 ? loose[0] : null;   // ambiguous matches are not suggested
}
