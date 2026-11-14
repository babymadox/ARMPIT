export const maxDuration = 60; // Singular reports are async; allow time to poll (raise on Pro)
import { NextResponse } from "next/server";
import { syncConnection } from "@/lib/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Scheduled (Vercel Cron). Pulls the last 2 days for every connection; one failing connection never blocks the rest.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  const { data: conns = [] } = await supabaseAdmin().from("tracker_connections").select("id,kind");
  const out: { id: string; ok: boolean; rows?: number; error?: string }[] = [];
  for (const c of conns!) {
    try { out.push({ id: c.id, ok: true, rows: (await syncConnection(c.id)).rows }); }
    catch (e) { console.error("sync failed", c.kind, e); out.push({ id: c.id, ok: false, error: e instanceof Error ? e.message : String(e) }); }
  }
  return NextResponse.json({ connections: out.length, results: out });
}
