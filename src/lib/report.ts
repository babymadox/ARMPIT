import { scrub } from "./scrub.ts";
import type { Feature } from "./features.ts";
import { FEATURES } from "./features.ts";

export type Check = { id: string; group: "Environment" | "Database" | "Integrations"; label: string; status: "ok" | "fail" | "unknown"; detail?: string; fix?: string };
export type Evidence = { id: string; label: string; at: string | null; detail?: string };
export type EventRow = { level: string; source: string; message: string; digest: string | null; created_at: string; org_id: string | null };
export type Report = {
  generatedAt: string; app: { commit: string | null; env: string | null; url: string | null };
  checks: Check[]; evidence: Evidence[]; counts: Record<string, number | null>; events: EventRow[];
};

/** A feature that is built but cannot work yet because something it needs is failing. */
export type EffectiveStatus = "working" | "built-unproven" | "blocked" | "partial" | "not-built";
export function effective(f: Feature, r: Report): { status: EffectiveStatus; why?: string } {
  if (f.status === "not-built") return { status: "not-built" };
  // a need may name a single check ("schema.sources") or a group ("schema.workflow" matches schema.workflow.*)
  const failing = (f.needs ?? []).flatMap((id) => r.checks.filter((c) => c.id === id || c.id.startsWith(id + "."))).filter((c) => c.status === "fail");
  if (failing.length) return { status: "blocked", why: failing.map((c) => c.label).join("; ") };
  if (f.status === "partial") return { status: "partial", why: f.note };
  if (f.manual && f.verifiedManually) return { status: "working", why: `confirmed manually ${f.verifiedManually}` };
  if (f.manual) return { status: "built-unproven", why: f.note ?? "needs a manual check" };
  if (f.evidence) { const e = r.evidence.find((x) => x.id === f.evidence); return e?.at ? { status: "working" } : { status: "built-unproven", why: "no run recorded yet" }; }
  return { status: "working" };
}

export function nextActions(r: Report): string[] {
  const out: string[] = [];
  for (const c of r.checks) if (c.status === "fail" && c.fix && !out.includes(c.fix)) out.push(c.fix);
  const recentErr = r.events.filter((e) => e.level === "error");
  if (recentErr.length) out.push(`Investigate ${recentErr.length} recent error event(s), newest: ${recentErr[0].source}: ${recentErr[0].message}`);
  for (const f of FEATURES) { const e = effective(f, r); if (e.status === "built-unproven") out.push(`Prove "${f.name}": ${e.why}`); }
  return out;
}

const cell = (s: string | null | undefined) => scrub(String(s ?? "")).replace(/\|/g, "\\|").replace(/\n/g, " ");
export function toMarkdown(r: Report): string {
  const L: string[] = [];
  const fails = r.checks.filter((c) => c.status === "fail").length, errs = r.events.filter((e) => e.level === "error").length;
  L.push(`# ARMPIT diagnostics`, `Generated ${r.generatedAt} · commit ${r.app.commit ?? "unknown"} · ${r.app.env ?? "unknown env"} · ${r.app.url ?? "unknown url"}`, "");
  L.push(`## Summary`, `- Failing checks: ${fails}`, `- Error events in this report: ${errs}`, "");
  const na = nextActions(r);
  L.push(`## Next actions`, ...(na.length ? na.map((a, i) => `${i + 1}. ${cell(a)}`) : ["Nothing outstanding."]), "");
  for (const g of ["Environment", "Database", "Integrations"] as const) {
    L.push(`## ${g}`, `| Check | Status | Detail |`, `|---|---|---|`);
    for (const c of r.checks.filter((x) => x.group === g)) L.push(`| ${cell(c.label)} | ${c.status.toUpperCase()} | ${cell(c.detail)} |`);
    L.push("");
  }
  L.push(`## Features`, `| Area | Feature | State | Note |`, `|---|---|---|---|`);
  for (const f of FEATURES) { const e = effective(f, r); L.push(`| ${f.area} | ${f.name} | ${e.status} | ${cell(e.why ?? f.note)} |`); }
  L.push("", `## Last proven working`, `| What | When | Detail |`, `|---|---|---|`);
  for (const e of r.evidence) L.push(`| ${cell(e.label)} | ${e.at ?? "never"} | ${cell(e.detail)} |`);
  L.push("", `## Data`, ...Object.entries(r.counts).map(([k, v]) => `- ${k}: ${v ?? "unavailable"}`));
  const problems = r.events.filter((e) => e.level !== "info");
  L.push("", `## Recent problems (warn/error)`, ...(problems.length ? problems.map((e) => `- ${e.created_at} [${e.level}] ${cell(e.source)}: ${cell(e.message)}${e.digest ? ` (digest ${cell(e.digest)})` : ""}`) : ["None recorded."]));
  const info = r.events.filter((e) => e.level === "info").slice(0, 10);
  L.push("", `## Recent activity`, ...(info.length ? info.map((e) => `- ${e.created_at} ${cell(e.source)}: ${cell(e.message)}`) : ["None recorded."]));
  return L.join("\n");
}
