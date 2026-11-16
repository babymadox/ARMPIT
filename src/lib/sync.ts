import { trackers } from "./integrations";
import { readCreds } from "./secrets";
import { supabaseAdmin } from "./supabase/admin";
import { planImport, type Pair } from "./structure";
import { errMsg, logEvent } from "./log";
import { fetchAll } from "./db";

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const chunks = <T,>(a: T[], n = 1000) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Who is asking: one workspace (user-triggered) or the scheduled job (all workspaces). */
export type Scope = { orgId: string } | "all-orgs";

type Opts = {
  /** Create partners for new agencies and link every (source, agency) pair, mirroring the tracker. Admin-triggered only. */
  autoLink?: boolean;
  ownerId?: string | null;
};

/**
 * Pulls stats for one connection and:
 *  1. records every (source, agency) pair it saw in tracker_sources,
 *  2. optionally creates partners/links so the structure matches the tracker,
 *  3. stores stats for linked pairs only. A pair carries its own numbers, so a source shared by two agencies
 *     is never double counted.
 */
async function syncCore(scope: Scope, connectionId: string, days: number, opts: Opts, ctx: { orgId?: string; kind?: string }) {
  const db = supabaseAdmin();
  const { data: c, error } = await db.from("tracker_connections").select("id,org_id,kind,vault_secret_id").eq("id", connectionId).single();
  if (error || !c) throw new Error("connection not found");
  if (scope !== "all-orgs" && c.org_id !== scope.orgId) throw new Error("connection not found");   // never act on another workspace's connection
  ctx.orgId = c.org_id; ctx.kind = c.kind;
  const adapter = trackers[c.kind as keyof typeof trackers];
  let stats;
  try { stats = await adapter.fetchStats(await readCreds(c.vault_secret_id, c.org_id), iso(Date.now() - days * 864e5), iso(Date.now())); }
  catch (e) { await db.from("tracker_connections").update({ status: "error" }).eq("id", c.id); /* best effort: the sync error below is what matters */ throw e; }

  const pairMap = new Map<string, Pair>();
  for (const s of stats) pairMap.set(`${s.externalId}|${s.group ?? ""}`, { source: s.externalId, agency: s.group ?? "" });
  const pairs = [...pairMap.values()];
  const now = new Date().toISOString();
  for (const part of chunks(pairs)) {
    const { error: e } = await db.from("tracker_sources").upsert(part.map((p) => ({ org_id: c.org_id, connection_id: c.id, external_id: p.source, external_group: p.agency, name: p.source, last_seen_at: now })), { onConflict: "connection_id,external_id,external_group" });
    if (e) throw new Error(`Could not save sources: ${e.message}`);
  }

  let createdPartners = 0, createdLinks = 0;
  if (opts.autoLink) {
    const [partners, existingLinks] = await Promise.all([   // all rows: Supabase silently caps a plain select at 1000
      fetchAll<{ id: string; name: string }>((f, t) => db.from("partners").select("id,name").eq("org_id", c.org_id).order("id").range(f, t)),
      fetchAll<{ external_id: string; external_group: string }>((f, t) => db.from("partner_links").select("external_id,external_group").eq("connection_id", c.id).order("id").range(f, t)),
    ]);
    const plan = planImport(pairs, partners, existingLinks);
    const ids = new Map<string, string>();
    for (const part of chunks(plan.toCreate, 500)) {
      const { data, error: e } = await db.from("partners").insert(part.map((name) => ({ org_id: c.org_id, name, type: "publisher", owner_id: opts.ownerId ?? null }))).select("id,name");
      if (e) throw new Error(e.message);
      data!.forEach((p) => ids.set(plan.agencyKey(p.name), p.id));
    }
    createdPartners = plan.toCreate.length;
    const rows = plan.newPairs.map((p) => ({ org_id: c.org_id, connection_id: c.id, partner_id: plan.partnerIdFor(p.agency) ?? ids.get(plan.agencyKey(p.agency))!, external_id: p.source, external_group: p.agency }));
    for (const part of chunks(rows)) {
      const { error: e } = await db.from("partner_links").insert(part);
      if (e) throw new Error(e.message);
    }
    createdLinks = rows.length;
  }

  const links = await fetchAll<{ id: string; external_id: string; external_group: string }>((f, t) => db.from("partner_links").select("id,external_id,external_group").eq("connection_id", c.id).order("id").range(f, t));
  const byPair = new Map(links.map((l) => [`${l.external_id}|${l.external_group}`, l.id]));
  const rows = stats.filter((s) => byPair.has(`${s.externalId}|${s.group ?? ""}`)).map((s) => ({ link_id: byPair.get(`${s.externalId}|${s.group ?? ""}`)!, org_id: c.org_id, day: s.day, metric: s.metric, value: s.value }));
  for (const part of chunks(rows)) { const { error: e } = await db.from("tracker_stats").upsert(part); if (e) throw new Error(e.message); }
  const { error: e5 } = await db.from("tracker_connections").update({ last_synced_at: now, status: "connected" }).eq("id", c.id);
  if (e5) throw new Error(`Could not record sync: ${e5.message}`);
  return { pairs: pairs.length, rows: rows.length, createdPartners, createdLinks };
}

/** Runs a sync and records the outcome (counts and duration on success, the scrubbed error on failure). */
export async function syncConnection(scope: Scope, connectionId: string, days = 2, opts: Opts = {}) {
  const ctx: { orgId?: string; kind?: string } = {}, t0 = Date.now();
  try {
    const r = await syncCore(scope, connectionId, days, opts, ctx);
    await logEvent({ orgId: ctx.orgId, level: "info", source: `sync.${ctx.kind}`, message: `synced ${r.rows} rows from ${r.pairs} source/agency pairs`, details: { ...r, days, autoLink: !!opts.autoLink, ms: Date.now() - t0 } });
    return r;
  } catch (e) {
    await logEvent({ orgId: ctx.orgId, level: "error", source: `sync.${ctx.kind ?? "unknown"}`, message: errMsg(e), details: { days, ms: Date.now() - t0 } });
    throw e;
  }
}
