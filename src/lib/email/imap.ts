import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { resolvePublic, type Target } from "./net.ts";
import { toInbound, type ParsedMail } from "./parse.ts";
import type { InboundMessage } from "../integrations/types.ts";

export type MailCreds = Record<string, string>;
export type MailState = { uidValidity?: string; lastUid?: number } | null | undefined;
export type PollStats = { scanned: number; imported: number; automated: number; self: number; noSender: number; large: number; failed: number; remaining: number };

export const MAX_PER_POLL = 50, MAX_SIZE = 2_000_000, INITIAL_DAYS = 7, INITIAL_MAX = 30;

// The few ImapFlow methods used, so a simulated mailbox can stand in during tests.
export interface ImapLike {
  connect(): Promise<void>; logout(): Promise<void>; close(): void; on(ev: string, fn: (...a: unknown[]) => void): unknown;
  getMailboxLock(path: string, o?: { readOnly?: boolean }): Promise<{ release(): void }>;
  mailbox: { uidValidity: bigint | number | string; uidNext: number } | false;
  search(q: object, o: { uid: true }): Promise<number[] | false>;
  fetchOne(uid: string, q: object, o: { uid: true }): Promise<{ size?: number; source?: Buffer; envelope?: { from?: { name?: string; address?: string }[]; subject?: string; date?: Date; messageId?: string } } | false>;
}
export type Deps = { Client?: new (o: Record<string, unknown>) => ImapLike; parse?: (src: Buffer) => Promise<ParsedMail>; resolve?: (host: string) => Promise<Target>; now?: () => number };

/** Turns library errors into something a person can act on. `side` says which server failed. */
export function explainMailError(e: unknown, side: "incoming (IMAP)" | "outgoing (SMTP)", host: string): string {
  const x = e as { authenticationFailed?: boolean; code?: string; responseText?: string; response?: string; message?: string };
  const msg = `${x?.responseText ?? ""} ${x?.response ?? ""} ${x?.message ?? ""}`.toLowerCase();
  if (x?.authenticationFailed || x?.code === "EAUTH" || /invalid credentials|authentication failed|auth.*(fail|invalid)|username and password not accepted|app password/.test(msg))
    return `The ${side} server rejected the sign-in. Check the address and password. Gmail, Outlook, Yahoo and iCloud need an app password, not your normal password.`;
  if (x?.code === "ETIMEDOUT" || /timed? ?out/.test(msg)) return `The ${side} server ${host} did not respond in time.`;
  if (x?.code === "ENOTFOUND" || x?.code === "EAI_AGAIN") return `The ${side} server ${host} could not be found.`;
  if (x?.code === "ECONNREFUSED") return `The ${side} server ${host} refused the connection. Check the port.`;
  if (/certificate|self.signed|hostname/.test(msg)) return `The ${side} server ${host} has a certificate problem, so the connection was refused for safety.`;
  return `Could not use the ${side} server ${host}: ${(x?.message ?? "unknown error").slice(0, 160)}`;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(Object.assign(new Error(`${what} timed out`), { code: "ETIMEDOUT" })), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

async function open(creds: MailCreds, deps: Deps) {
  const port = Number(creds.imap_port || 993);
  const target = await (deps.resolve ?? ((h) => resolvePublic(h)))(creds.imap_host);
  const Client = deps.Client ?? (ImapFlow as unknown as NonNullable<Deps["Client"]>);
  const client = new Client({ host: target.ip, port, secure: port === 993, doSTARTTLS: port !== 993 ? true : undefined, auth: { user: creds.username || creds.email, pass: creds.password },
    tls: { servername: target.servername, rejectUnauthorized: true }, logger: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
  client.on("error", () => { /* surfaced through the awaited call instead; an unhandled 'error' event would crash the process */ });
  try { await withTimeout(client.connect(), 20_000, "Connecting"); } catch (e) { try { client.close(); } catch { /* already closed */ } throw new Error(explainMailError(e, "incoming (IMAP)", creds.imap_host)); }
  return client;
}

/** Signs in and out: proves the address, password and server work. Reads nothing. */
export async function verifyImap(creds: MailCreds, deps: Deps = {}) { const c = await open(creds, deps); try { await c.logout(); } catch { c.close(); } }

/**
 * Fetches mail that arrived since `state` (INBOX only, read-only: messages are never marked read or moved).
 * First run: the last 7 days, at most 30 messages. After that: only new UIDs, at most 50 per call, so a big backlog
 * is worked through over several polls instead of one long request.
 */
export async function pollMailbox(creds: MailCreds, state: MailState, deps: Deps = {}): Promise<{ messages: InboundMessage[]; state: { uidValidity: string; lastUid: number }; stats: PollStats }> {
  const now = deps.now ?? Date.now, parse = deps.parse ?? ((b: Buffer) => simpleParser(b) as unknown as Promise<ParsedMail>);
  const stats: PollStats = { scanned: 0, imported: 0, automated: 0, self: 0, noSender: 0, large: 0, failed: 0, remaining: 0 };
  const client = await open(creds, deps);
  const messages: InboundMessage[] = [];
  try {
    const lock = await withTimeout(client.getMailboxLock("INBOX", { readOnly: true }), 15_000, "Opening the inbox");
    try {
      if (!client.mailbox) throw new Error("The inbox could not be opened");
      const validity = String(client.mailbox.uidValidity), nextUid = client.mailbox.uidNext;
      const same = !!state && state.uidValidity === validity && typeof state.lastUid === "number";
      let uids: number[];
      if (same) uids = ((await client.search({ uid: `${state!.lastUid! + 1}:*` }, { uid: true })) || []).filter((u) => u > state!.lastUid!);   // "n:*" always includes the newest message, even when it is older than n
      else uids = ((await client.search({ since: new Date(now() - INITIAL_DAYS * 864e5) }, { uid: true })) || []).slice(-INITIAL_MAX);
      uids.sort((a, b) => a - b);
      const batch = uids.slice(0, MAX_PER_POLL); stats.remaining = uids.length - batch.length;
      for (const uid of batch) {
        stats.scanned++;
        try {
          const meta = await client.fetchOne(String(uid), { uid: true, size: true, envelope: true }, { uid: true });
          if (!meta) continue;
          const fallbackId = `uid:${validity}:${uid}`;
          if ((meta.size ?? 0) > MAX_SIZE) {                                         // too big to download: keep a stub so it is not lost silently
            const f = meta.envelope?.from?.[0]; const addr = f?.address?.toLowerCase();
            if (addr && addr !== creds.email.toLowerCase()) { stats.large++; messages.push({ externalConversationId: addr, externalId: meta.envelope?.messageId || fallbackId, title: f?.name || addr, sender: f?.name || addr, subject: meta.envelope?.subject || "(no subject)", body: `[This message is ${(meta.size! / 1e6).toFixed(1)} MB and was not imported. Open it in your mail app.]`, sentAt: (meta.envelope?.date ?? new Date(now())).toISOString() }); }
            continue;
          }
          const full = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!full || !full.source) continue;
          const r = toInbound(await parse(full.source), creds.email, fallbackId, new Date(now()));
          if ("skip" in r) { if (r.skip === "automated") stats.automated++; else if (r.skip === "self") stats.self++; else stats.noSender++; continue; }
          stats.imported++; messages.push(r.msg);
        } catch { stats.failed++; }                                                  // one unreadable message must not block the rest
      }
      const lastUid = batch.length ? batch[batch.length - 1] : same ? state!.lastUid! : Math.max(0, nextUid - 1);
      return { messages, state: { uidValidity: validity, lastUid }, stats };
    } finally { lock.release(); }
  } finally { try { await client.logout(); } catch { client.close(); } }
}
