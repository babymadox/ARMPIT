/** Pure helpers for turning raw mail into chat-style messages. No imports, so they are unit-tested directly. */

export function htmlToText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Drops the quoted earlier conversation so a chat bubble shows only what the person just wrote. Never returns an empty body for a non-empty message. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l, i) => /^On .{5,200}wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{5,}\s*$/.test(l) && /^From:/i.test(lines[i + 1] ?? "")
    || (/^From:\s.+/i.test(l) && /^(Sent|Date):/i.test(lines[i + 1] ?? "")) || (/^>/.test(l) && i > 0 && lines.slice(0, i).some((x) => x.trim())));
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  return kept || text.trim();
}

export const replySubject = (s?: string | null) => { const t = (s ?? "").replace(/[\r\n]+/g, " ").trim(); return !t ? "Re: (no subject)" : /^(re|aw|sv)\s*:/i.test(t) ? t : `Re: ${t}`; };

/** Newsletters, notifications and bounces should not become partner conversations. */
export function isAutomated(get: (name: string) => string | undefined, fromAddress: string): boolean {
  const auto = get("auto-submitted")?.toLowerCase().trim();
  if (auto && auto !== "no") return true;
  if (/^(bulk|list|junk)$/i.test(get("precedence")?.trim() ?? "")) return true;
  if (get("list-id") || get("list-unsubscribe")) return true;
  return /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?)([+._-].*)?@/i.test(fromAddress);
}

export type ParsedMail = {
  from?: { value?: { name?: string; address?: string }[] }; subject?: string; text?: string; html?: string | false; messageId?: string; date?: Date;
  attachments?: { filename?: string; contentType?: string }[]; headers: { get(name: string): unknown };
};
export type Inbound = { externalConversationId: string; externalId: string; title: string; sender: string; subject: string; body: string; sentAt: string; attachments: { name: string; kind: string }[] };

const headerText = (h: ParsedMail["headers"]) => (name: string) => { const v = h.get(name); return v == null ? undefined : typeof v === "string" ? v : typeof v === "object" && "text" in (v as object) ? String((v as { text: unknown }).text) : String(v); };

/** Returns null for mail that should not be imported (own messages, automated mail, no sender). */
export function toInbound(p: ParsedMail, mailbox: string, fallbackId: string, now = new Date()): { msg: Inbound } | { skip: "self" | "automated" | "no_sender" } {
  const from = p.from?.value?.[0], address = from?.address?.trim().toLowerCase();
  if (!address) return { skip: "no_sender" };
  if (address === mailbox.trim().toLowerCase()) return { skip: "self" };
  if (isAutomated(headerText(p.headers), address)) return { skip: "automated" };
  const raw = p.text?.trim() ? p.text : typeof p.html === "string" ? htmlToText(p.html) : "";
  let body = stripQuoted(raw).slice(0, 20_000).trim();
  const atts = (p.attachments ?? []).map((a) => ({ name: a.filename ?? "attachment", kind: a.contentType ?? "file" }));
  if (!body) body = atts.length ? `📎 ${atts.map((a) => a.name).join(", ")}` : "(no text)";
  const name = from?.name?.trim();
  return { msg: { externalConversationId: address, externalId: p.messageId?.trim() || fallbackId, title: name || address, sender: name || address,
    subject: (p.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200) || "(no subject)", body, sentAt: (p.date && !isNaN(+p.date) ? p.date : now).toISOString(), attachments: atts } };
}
