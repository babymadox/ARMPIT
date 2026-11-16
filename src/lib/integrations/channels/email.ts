import type { ChannelAdapter, Creds } from "../types";
import { pollMailbox, verifyImap, type MailState } from "../../email/imap.ts";
import { sendMail, verifySmtp } from "../../email/smtp.ts";
import { replySubject } from "../../email/parse.ts";

/**
 * Email over IMAP/SMTP: works with any mailbox (Gmail, Outlook, Yahoo, iCloud, company domains).
 * Incoming mail is polled (there is no push for IMAP on serverless); replies go out through the account's SMTP server.
 * Credentials are stored in Vault. Gmail/Outlook/Yahoo/iCloud require an app password.
 */
const need = (c: Creds) => { for (const k of ["email", "password", "imap_host", "smtp_host"]) if (!c[k]) throw new Error(`Email setting missing: ${k}`); };

export const email: ChannelAdapter = {
  kind: "email",
  async connect(creds) { need(creds); await verifyImap(creds); await verifySmtp(creds); return { account: creds.email, creds }; },
  async disconnect() { /* nothing registered at the provider */ },
  async status(creds) { try { need(creds); await verifyImap(creds); return { ok: true, detail: "Signed in" }; } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : String(e) }; } },
  async parseWebhook() { throw new Error("Email has no webhook: it is polled"); },
  async send(creds, to, body, ctx) {
    need(creds);
    const r = await sendMail(creds, { to, subject: replySubject(ctx?.subject), text: body, inReplyTo: ctx?.inReplyTo ?? null });
    return { externalId: r.messageId };
  },
  async poll(creds, state) { need(creds); const r = await pollMailbox(creds, state as MailState); return { messages: r.messages, state: r.state, stats: { ...r.stats } }; },
};
