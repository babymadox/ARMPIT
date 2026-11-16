import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundMessage } from "./integrations/types";
import { notify } from "./notify";

type Conn = { id: string; org_id: string; member_id: string; kind: string };

/**
 * Stores inbound messages. Safe to call twice with the same delivery (providers retry):
 *  - the conversation is created once and its owner / linked partner are never overwritten,
 *  - a message is inserted once per (conversation, external id); only a NEW message marks the chat unread.
 * Runs with the service-role client, so every query is scoped by the connection's org_id.
 */
export async function ingestMessages(db: SupabaseClient, conn: Conn, msgs: InboundMessage[]) {
  let stored = 0;
  for (const m of msgs) {
    const { error: e0 } = await db.from("conversations").upsert(
      { org_id: conn.org_id, channel: conn.kind, connection_id: conn.id, external_id: m.externalConversationId, title: m.title ?? null, owner_id: conn.member_id },
      { onConflict: "org_id,channel,external_id", ignoreDuplicates: true });
    if (e0) throw new Error(e0.message);       // the webhook answers 5xx so the provider retries
    const { data: conv, error } = await db.from("conversations").select("id,unread,owner_id,title").eq("org_id", conn.org_id).eq("channel", conn.kind).eq("external_id", m.externalConversationId).single();
    if (error || !conv) throw new Error(`conversation lookup failed: ${error?.message}`);
    const { data: inserted, error: e2 } = await db.from("messages").upsert(
      { org_id: conn.org_id, conversation_id: conv.id, direction: "in", sender_name: m.sender, body: m.body, attachments: m.attachments ?? [], external_id: m.externalId, sent_at: m.sentAt, ...(m.subject ? { subject: m.subject } : {}) },
      { onConflict: "conversation_id,external_id", ignoreDuplicates: true }).select("id");
    if (e2) throw new Error(e2.message);
    if (inserted?.length) {
      stored++;
      { const { error: werr } = await db.from("conversations").update({ unread: true, last_message_at: m.sentAt, last_direction: "in", last_inbound_at: m.sentAt }).eq("id", conv.id).eq("org_id", conn.org_id); if (werr) throw new Error(werr.message); }
      // One notification per quiet-to-active transition, not one per message: only when the chat was already read.
      if (!conv.unread && conv.owner_id) await notify({ orgId: conn.org_id, memberId: conv.owner_id, title: `New message from ${m.sender}`, body: `in ${conv.title ?? "a chat"}`, href: `/inbox?c=${conv.id}` });
    }
  }
  return stored;
}
