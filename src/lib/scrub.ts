/** Redaction for anything the app stores or logs. Pure: no imports, so it is unit-tested directly. */
const RULES: [RegExp, string][] = [
  [/(?<![0-9])\d{6,12}:[A-Za-z0-9_-]{30,}/g, "[telegram-token]"],   // no leading \b: the token follows "bot" in API URLs (/bot123:ABC/sendMessage)
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[jwt]"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[supabase-key]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[api-key]"],
  [/(bearer\s+)[A-Za-z0-9._~+\/=-]{8,}/gi, "$1[redacted]"],
  [/([?&](?:api_key|apikey|token|key|secret)=)[^&\s"']+/gi, "$1[redacted]"],
  [/((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,}]{4,}/gi, "$1[redacted]"],
];
export const scrub = (s: string) => RULES.reduce((t, [re, r]) => t.replace(re, r), s);

// Keys whose values are never stored: message content and credentials.
const OMIT = /^(body|text|caption|content|password|token|secret|authorization|cookie|api_?key|bot_?token|creds?|webhook_?secret)$/i;
export function scrubDetails(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return scrub(v).slice(0, 500);
  if (depth >= 4) return "[too deep]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubDetails(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as object).slice(0, 30).map(([k, x]) => [k, OMIT.test(k) ? "[omitted]" : scrubDetails(x, depth + 1)]));
  return String(v).slice(0, 100);
}

export type EventInput = { orgId?: string | null; level: "info" | "warn" | "error"; source: string; message: string; details?: unknown; digest?: string };
/** The exact row that gets stored. Size-capped so a runaway log line cannot bloat the table. */
export function buildEventRow(e: EventInput) {
  let details = e.details === undefined ? null : scrubDetails(e.details);
  if (details != null && JSON.stringify(details).length > 4000) details = { truncated: true };
  return { org_id: e.orgId ?? null, level: e.level, source: e.source.slice(0, 80), message: scrub(e.message).slice(0, 500), details, digest: e.digest ? e.digest.slice(0, 40) : null };
}
export const errMsg = (e: unknown) => scrub(e instanceof Error ? e.message : String(e));
