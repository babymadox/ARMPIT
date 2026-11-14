import { NextResponse } from "next/server";
import { trackers } from "@/lib/integrations";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Scheduled (Vercel Cron / Supabase pg_cron -> HTTP). Pulls the last 2 days of stats per connection.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  const db = supabaseAdmin();
  const { data: conns = [] } = await db.from("tracker_connections").select("id,org_id,kind,vault_secret_id");
  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  let rows = 0;
  for (const c of conns!) {
    const adapter = trackers[c.kind as keyof typeof trackers];
    // TODO: read credentials from Supabase Vault via c.vault_secret_id (decrypted_secrets view, service role only).
    const creds: Record<string, string> = {};
    const stats = await adapter.fetchStats(creds, from, to);
    const { data: links = [] } = await db.from("partner_links").select("id,external_id").eq("connection_id", c.id);
    const byExt = new Map(links!.map((l) => [l.external_id, l.id]));
    const out = stats.filter((s) => byExt.has(s.externalId)).map((s) => ({ link_id: byExt.get(s.externalId)!, org_id: c.org_id, day: s.day, metric: s.metric, value: s.value }));
    if (out.length) await db.from("tracker_stats").upsert(out);
    await db.from("tracker_connections").update({ last_synced_at: new Date().toISOString() }).eq("id", c.id);
    rows += out.length;
  }
  return NextResponse.json({ connections: conns!.length, rows });
}
