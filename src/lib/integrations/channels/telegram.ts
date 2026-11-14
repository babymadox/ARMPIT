import { timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, Creds, InboundMessage } from "../types";

/**
 * Telegram via the Bot API (https://core.telegram.org/bots/api).
 * Setup per workspace: create a bot with @BotFather, paste its token in Settings. The bot must be added to each
 * partner group, and group privacy must be OFF (/setprivacy -> Disable) or the bot only sees commands and mentions.
 * Limits: bots receive new messages only (no history) and only from chats they are in.
 */
const API = "https://api.telegram.org";
export const MAX_TEXT = 4096;

type Opts = { fetch?: typeof fetch; secret?: () => string };

async function call<T>(f: typeof fetch, token: string, method: string, payload?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await f(`${API}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) });
  } catch { throw new Error("Could not reach Telegram"); }
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.description ? `Telegram: ${j.description}` : `Telegram returned ${res.status}`);
  return j.result as T;
}
const token = (c: Creds) => { if (!c.bot_token) throw new Error("Telegram bot token missing"); return c.bot_token; };
const sameSecret = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** What to show for messages with no text. Returns null for service messages (joins, pins...) which are skipped. */
function describe(m: any): { body: string; attachments: { name: string; kind: string }[] } | null {
  const text: string | undefined = m.text ?? m.caption;
  const att: { name: string; kind: string }[] = [];
  let label = "";
  if (m.photo) { att.push({ name: "photo", kind: "photo" }); label = "📷 Photo"; }
  else if (m.document) { att.push({ name: m.document.file_name ?? "file", kind: "document" }); label = `📎 ${m.document.file_name ?? "File"}`; }
  else if (m.voice) { att.push({ name: "voice message", kind: "voice" }); label = "🎤 Voice message"; }
  else if (m.video || m.video_note) { att.push({ name: "video", kind: "video" }); label = "🎬 Video"; }
  else if (m.audio) { att.push({ name: m.audio.file_name ?? "audio", kind: "audio" }); label = "🎵 Audio"; }
  else if (m.sticker) label = `${m.sticker.emoji ?? ""} Sticker`.trim();
  else if (m.location) label = "📍 Location";
  else if (m.contact) label = "👤 Contact";
  if (!text && !label) return null;
  return { body: text ? (label && m.caption ? `${label}\n${text}` : text) : label, attachments: att };
}

export function makeTelegram({ fetch: f = fetch, secret = () => crypto.randomUUID().replace(/-/g, "") }: Opts = {}): ChannelAdapter {
  return {
    kind: "telegram",

    async connect(creds, webhookUrl) {
      const t = token(creds);
      const me = await call<{ username?: string; is_bot: boolean }>(f, t, "getMe");
      if (!me.is_bot) throw new Error("That token does not belong to a bot");
      const webhook_secret = secret();
      await call(f, t, "setWebhook", { url: webhookUrl, secret_token: webhook_secret, allowed_updates: ["message"] });
      return { account: me.username ? `@${me.username}` : "bot", creds: { bot_token: t, webhook_secret } };
    },

    async disconnect(creds) { try { await call(f, token(creds), "deleteWebhook"); } catch { /* best effort */ } },

    async status(creds, webhookUrl) {
      try {
        const w = await call<{ url: string; last_error_message?: string; pending_update_count: number }>(f, token(creds), "getWebhookInfo");
        if (w.url !== webhookUrl) return { ok: false, detail: "Webhook points somewhere else. Disconnect and reconnect." };
        if (w.last_error_message) return { ok: false, detail: `Telegram could not deliver: ${w.last_error_message}` };
        return { ok: true, detail: w.pending_update_count ? `Working (${w.pending_update_count} waiting)` : "Working" };
      } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
    },

    async parseWebhook(req, creds) {
      const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (!creds.webhook_secret || !sameSecret(got, creds.webhook_secret)) throw new Error("bad webhook secret");
      const u: any = await req.json().catch(() => null);
      const m = u?.message;                                       // edits, channel posts and the rest are not requested or ignored
      if (!m || !m.chat || m.from?.is_bot) return [];
      const d = describe(m);
      if (!d) return [];
      const chat = m.chat;
      const who = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "Unknown";
      const title = chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || String(chat.id));
      const out: InboundMessage = { externalConversationId: String(chat.id), externalId: String(m.message_id), title, sender: who, body: d.body, sentAt: new Date((m.date ?? Date.now() / 1000) * 1000).toISOString(), attachments: d.attachments };
      return [out];
    },

    async send(creds, chatId, body) {
      if (!body.trim()) throw new Error("Message is empty");
      if (body.length > MAX_TEXT) throw new Error(`Telegram messages are limited to ${MAX_TEXT} characters`);
      const r = await call<{ message_id: number }>(f, token(creds), "sendMessage", { chat_id: chatId, text: body });
      return { externalId: String(r.message_id) };
    },
  };
}
export const telegram = makeTelegram();
