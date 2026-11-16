import { NextResponse } from "next/server";
import { channels } from "@/lib/integrations";
import { ingestMessages } from "@/lib/inbox";
import { readCreds } from "@/lib/secrets";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { errMsg, logEvent } from "@/lib/log";

export const maxDuration = 30;

/**
 * Inbound messages from a channel provider. The URL carries the connection id (?c=...), so a delivery is always
 * attributed to exactly one workspace; the adapter then verifies the provider's per-connection secret.
 * Always answers 200 for deliveries we deliberately ignore, so the provider does not retry them forever.
 */
export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  const adapter = (channels as Record<string, (typeof channels)[keyof typeof channels]>)[channel];
  const connId = new URL(req.url).searchParams.get("c");
  if (!adapter || !connId) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = supabaseAdmin();
  const { data: conn } = await db.from("channel_connections").select("id,org_id,member_id,kind,vault_secret_id").eq("id", connId).eq("kind", channel).maybeSingle();
  if (!conn) return NextResponse.json({ error: "not found" }, { status: 404 });

  let msgs;
  try { msgs = await adapter.parseWebhook(req, await readCreds(conn.vault_secret_id, conn.org_id)); }
  catch (e) {
    await logEvent({ orgId: conn.org_id, level: "warn", source: `webhook.${channel}`, message: `delivery rejected: ${errMsg(e)}` });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });   // bad secret: say nothing more
  }

  try { await ingestMessages(db, conn, msgs); }
  catch (e) { await logEvent({ orgId: conn.org_id, level: "error", source: `webhook.${channel}`, message: `ingest failed: ${errMsg(e)}`, details: { messages: msgs.length } }); return NextResponse.json({ error: "temporary failure" }, { status: 500 }); } // 5xx makes the provider retry
  return NextResponse.json({ ok: true });
}
