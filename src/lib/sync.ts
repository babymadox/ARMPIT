import { trackers } from "./integrations";
import { readCreds } from "./secrets";
import { supabaseAdmin } from "./supabase/admin";

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Pulls stats for one connection, records every source it saw, and stores stats for linked sources only. */
export async function syncConnection(connectionId: string, days = 2) {
  const db = supabaseAdmin();
  const { data: c, error } = await db.from("tracker_connections").select("id,org_id,kind,vault_secret_id").eq("id", connectionId).single();
  if (error || !c) throw new Error("connection not found");
  const adapter = trackers[c.kind as keyof typeof trackers];
  let stats;
  try { stats = await adapter.fetchStats(await readCreds(c.vault_secret_id), iso(Date.now() - days * 864e5), iso(Date.now())); }
  catch (e) { await db.from("tracker_connections").update({ status: "error" }).eq("id", c.id); throw e; }

  const seen = [...new Set(stats.map((s) => s.externalId))];
  if (seen.length) {
    await db.from("tracker_sources").upsert(seen.map((x) => ({ org_id: c.org_id, connection_id: c.id, external_id: x, name: x, last_seen_at: new Date().toISOString() })), { onConflict: "connection_id,external_id" });
  }
  const { data: links = [] } = await db.from("partner_links").select("id,external_id").eq("connection_id", c.id);
  const byExt = new Map(links!.map((l) => [l.external_id, l.id]));
  const rows = stats.filter((s) => byExt.has(s.externalId)).map((s) => ({ link_id: byExt.get(s.externalId)!, org_id: c.org_id, day: s.day, metric: s.metric, value: s.value }));
  if (rows.length) { const { error: e2 } = await db.from("tracker_stats").upsert(rows); if (e2) throw new Error(e2.message); }
  await db.from("tracker_connections").update({ last_synced_at: new Date().toISOString(), status: "connected" }).eq("id", c.id);
  return { sources: seen.length, rows: rows.length };
}
