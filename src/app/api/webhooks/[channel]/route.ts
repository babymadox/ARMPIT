import { NextResponse } from "next/server";
import { channels } from "@/lib/integrations";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Inbound messages from Telegram / WhatsApp / Teams / Gmail land here.
// The adapter verifies the provider's signature; we then upsert the conversation and message.
export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  const adapter = (channels as Record<string, (typeof channels)[keyof typeof channels]>)[channel];
  if (!adapter) return NextResponse.json({ error: "unknown channel" }, { status: 404 });
  let msgs;
  try { msgs = await adapter.parseWebhook(req); } catch (e) { return NextResponse.json({ error: String(e) }, { status: 401 }); }

  const db = supabaseAdmin();
  for (const m of msgs) {
    // TODO: resolve org_id + owner from the channel_connection that received the message.
    const { data: conn } = await db.from("channel_connections").select("id,org_id,member_id").eq("kind", channel).limit(1).maybeSingle();
    if (!conn) continue;
    const { data: conv } = await db.from("conversations").upsert(
      { org_id: conn.org_id, channel, connection_id: conn.id, external_id: m.externalConversationId, title: m.title, owner_id: conn.member_id, unread: true, last_message_at: m.sentAt },
      { onConflict: "org_id,channel,external_id" }).select("id").single();
    if (conv) await db.from("messages").upsert({ org_id: conn.org_id, conversation_id: conv.id, direction: "in", sender_name: m.sender, body: m.body, attachments: m.attachments ?? [], external_id: m.externalId, sent_at: m.sentAt }, { onConflict: "conversation_id,external_id" });
  }
  return NextResponse.json({ ok: true });
}
