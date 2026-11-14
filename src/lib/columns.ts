import { DEFAULT_COLUMNS, SINGULAR_DERIVED, SINGULAR_METRICS } from "./integrations/trackers/singular-metrics.ts";

export type Col = { key: string; label: string; group: string; hint?: string; fmt: "count" | "money" | "percent"; derived?: { num: string; den: string } };
export type Catalog = { cols: Col[]; defaults: string[] };

/** Column catalogue per tracker. Trackers without a catalogue fall back to whatever metrics their data contains. */
export function catalogFor(kind: string, seenMetrics: string[] = []): Catalog {
  if (kind === "singular") {
    const base: Col[] = SINGULAR_METRICS.map((m) => ({ key: m.key, label: m.label, group: m.group, hint: m.hint, fmt: m.kind }));
    const derived: Col[] = SINGULAR_DERIVED.map((d) => ({ key: d.key, label: d.label, group: d.group, hint: d.hint, fmt: d.kind, derived: { num: d.num, den: d.den } }));
    return { cols: [...base, ...derived], defaults: DEFAULT_COLUMNS };
  }
  const cols = seenMetrics.map((k) => ({ key: k, label: k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), group: "Metrics", fmt: /cost|revenue|commission|payout|deposit/i.test(k) ? "money" as const : "count" as const }));
  return { cols, defaults: cols.slice(0, 5).map((c) => c.key) };
}

export const cookieName = (kind: string) => `cols_${kind}`;

/** Keeps only valid keys, in catalogue order; empty or invalid selections fall back to the defaults. */
export function parseSelection(raw: string | undefined, cat: Catalog): string[] {
  const want = new Set((raw ?? "").split(",").filter(Boolean));
  const picked = cat.cols.filter((c) => want.has(c.key)).map((c) => c.key);
  return picked.length ? picked : cat.defaults;
}

export type Totals = Record<string, number>;
/** Derived columns are computed from totals (a ratio of sums), never by summing per-row ratios. */
export function valueOf(col: Col, t: Totals): number | null {
  if (col.derived) { const d = t[col.derived.den], n = t[col.derived.num]; return d > 0 && n != null ? n / d * (col.fmt === "percent" ? 100 : 1) : null; }
  return t[col.key] ?? null;
}

export function formatValue(col: Col, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (col.fmt === "money") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (col.fmt === "percent") return `${v.toFixed(2)}%`;
  return Math.round(v).toLocaleString("en-US");
}
