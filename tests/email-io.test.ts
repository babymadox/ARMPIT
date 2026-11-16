import { test } from "node:test";
import assert from "node:assert/strict";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { pollMailbox, explainMailError, MAX_PER_POLL, type ImapLike } from "../src/lib/email/imap.ts";
import { sendMail, verifySmtp, isMailbox } from "../src/lib/email/smtp.ts";
import { toInbound } from "../src/lib/email/parse.ts";

// ---------------- a simulated mailbox ----------------
type Msg = { uid: number; size?: number; mail: any; date?: Date };
function fakeMailbox(msgs: Msg[], o: { uidValidity?: number; failLogin?: boolean; failUid?: number } = {}) {
  const log = { locks: 0, released: 0, logouts: 0, closes: 0, searches: [] as any[] };
  const Client = class implements ImapLike {
    mailbox = { uidValidity: o.uidValidity ?? 7, uidNext: Math.max(0, ...msgs.map((m) => m.uid)) + 1 };
    on() { return this; }
    async connect() { if (o.failLogin) throw Object.assign(new Error("Command failed"), { authenticationFailed: true }); }
    async logout() { log.logouts++; } close() { log.closes++; }
    async getMailboxLock() { log.locks++; return { release: () => { log.released++; } }; }
    async search(q: any) {
      log.searches.push(q);
      if (q.uid) { const from = Number(String(q.uid).split(":")[0]); const all = msgs.map((m) => m.uid).sort((a, b) => a - b); return all.filter((u) => u >= from).length ? all.filter((u) => u >= from) : all.slice(-1); }   // IMAP quirk: "n:*" always includes the newest
      return msgs.filter((m) => (m.date ?? new Date()) >= q.since).map((m) => m.uid);
    }
    async fetchOne(uid: string, q: any) {
      const m = msgs.find((x) => x.uid === Number(uid)); if (!m) return false;
      if (q.source) { if (o.failUid === m.uid) throw new Error("corrupt"); return { source: Buffer.from(JSON.stringify(m.mail)) }; }
      return { size: m.size ?? 1000, envelope: { from: [{ name: m.mail.from?.value?.[0]?.name, address: m.mail.from?.value?.[0]?.address }], subject: m.mail.subject, messageId: m.mail.messageId, date: new Date("2026-11-03T00:00:00Z") } };
    }
  } as any;
  return { Client, log };
}
const mk = (uid: number, from = "maya@lp.com", extra: any = {}): Msg => ({ uid, mail: { from: { value: [{ name: "Maya", address: from }] }, subject: `S${uid}`, text: `body ${uid}`, messageId: `<m${uid}@x>`, date: new Date("2026-11-03T10:00:00Z"), attachments: [], headers: new Map(), ...extra } });
const creds = { email: "me@x.com", password: "pw", imap_host: "imap.x.com", imap_port: "993" };
const deps = (box: ReturnType<typeof fakeMailbox>) => ({ Client: box.Client, parse: async (b: Buffer) => { const j = JSON.parse(b.toString()); j.date = new Date(j.date); j.headers = new Map(Object.entries(j.headersObj ?? {})); return j; }, resolve: async (h: string) => ({ ip: "8.8.8.8", servername: h }), now: () => Date.parse("2026-11-04T00:00:00Z") });

test("first poll imports recent mail and remembers where it stopped", async () => {
  const box = fakeMailbox(Array.from({ length: 40 }, (_, i) => ({ ...mk(i + 1), date: new Date("2026-11-03T00:00:00Z") })));
  const r = await pollMailbox(creds, null, deps(box));
  assert.equal(r.messages.length, 30, "at most 30 on the first run"); assert.deepEqual(r.state, { uidValidity: "7", lastUid: 40 });
  assert.equal(r.messages[0].subject, "S11"); assert.equal(r.messages[0].externalConversationId, "maya@lp.com"); assert.equal(r.messages.at(-1)!.externalId, "<m40@x>");
  assert.deepEqual([box.log.locks, box.log.released, box.log.logouts], [1, 1, 1], "the mailbox lock is released and the session closed");
});
test("later polls fetch only new mail, even though IMAP always returns the newest message", async () => {
  const box = fakeMailbox([mk(5), mk(6), mk(7)]);
  const none = await pollMailbox(creds, { uidValidity: "7", lastUid: 7 }, deps(box));
  assert.equal(none.messages.length, 0); assert.equal(none.state.lastUid, 7);
  const some = await pollMailbox(creds, { uidValidity: "7", lastUid: 5 }, deps(box));
  assert.deepEqual(some.messages.map((m) => m.subject), ["S6", "S7"]); assert.equal(some.state.lastUid, 7);
});
test("if the mailbox was rebuilt (uid validity changed) polling starts over instead of missing mail", async () => {
  const box = fakeMailbox([{ ...mk(2), date: new Date("2026-11-03T00:00:00Z") }], { uidValidity: 99 });
  const r = await pollMailbox(creds, { uidValidity: "7", lastUid: 500 }, deps(box));
  assert.equal(r.messages.length, 1); assert.deepEqual(r.state, { uidValidity: "99", lastUid: 2 });
});
test("a big backlog is worked through 50 at a time without skipping any", async () => {
  const box = fakeMailbox(Array.from({ length: 120 }, (_, i) => mk(i + 1)));
  const a = await pollMailbox(creds, { uidValidity: "7", lastUid: 0 }, deps(box));
  assert.equal(a.messages.length, MAX_PER_POLL); assert.equal(a.stats.remaining, 70); assert.equal(a.state.lastUid, 50);
  const b = await pollMailbox(creds, a.state, deps(box)); assert.equal(b.messages[0].subject, "S51"); assert.equal(b.state.lastUid, 100);
  const c = await pollMailbox(creds, b.state, deps(box)); assert.equal(c.messages.length, 20); assert.equal(c.stats.remaining, 0);
});
test("automated mail, own mail and oversized mail are handled, and none of it stalls the position", async () => {
  const box = fakeMailbox([mk(1, "noreply@shop.com"), mk(2, "me@x.com"), { ...mk(3), size: 5_000_000 }, mk(4, "partner@y.com", { headersObj: { "list-id": "<l>" } }), mk(5, "real@y.com")]);
  const r = await pollMailbox(creds, { uidValidity: "7", lastUid: 0 }, deps(box));
  assert.deepEqual(r.messages.map((m) => m.externalConversationId), ["maya@lp.com", "real@y.com"]);
  assert.match(r.messages[0].body, /5\.0 MB and was not imported/);
  assert.deepEqual([r.stats.automated, r.stats.self, r.stats.large, r.stats.imported], [2, 1, 1, 1]); assert.equal(r.state.lastUid, 5);
});
test("one unreadable message does not block the others", async () => {
  const box = fakeMailbox([mk(1), mk(2), mk(3)], { failUid: 2 });
  const r = await pollMailbox(creds, { uidValidity: "7", lastUid: 0 }, deps(box));
  assert.deepEqual(r.messages.map((m) => m.subject), ["S1", "S3"]); assert.equal(r.stats.failed, 1); assert.equal(r.state.lastUid, 3);
});
test("a rejected password gives a clear message and leaves nothing open", async () => {
  const box = fakeMailbox([], { failLogin: true });
  await assert.rejects(pollMailbox(creds, null, deps(box)), /rejected the sign-in.*app password/);
  assert.equal(box.log.closes, 1);
});
test("an internal mail host is refused before any connection is made", async () => {
  const box = fakeMailbox([]);
  await assert.rejects(pollMailbox({ ...creds, imap_host: "169.254.169.254" }, null, { Client: box.Client }), /not allowed/);
  assert.equal(box.log.locks, 0);
});
test("mail errors are explained plainly", () => {
  assert.match(explainMailError({ code: "ETIMEDOUT" }, "incoming (IMAP)", "imap.x.com"), /did not respond in time/);
  assert.match(explainMailError({ code: "ENOTFOUND" }, "outgoing (SMTP)", "smtp.x.com"), /could not be found/);
  assert.match(explainMailError({ code: "ECONNREFUSED" }, "incoming (IMAP)", "h"), /refused the connection/);
  assert.match(explainMailError({ message: "self signed certificate" }, "incoming (IMAP)", "h"), /certificate problem/);
  assert.match(explainMailError({ responseText: "Invalid credentials (Failure)" }, "incoming (IMAP)", "h"), /rejected the sign-in/);
  assert.ok(!explainMailError(new Error("x".repeat(500)), "incoming (IMAP)", "h").includes("x".repeat(200)), "long server messages are truncated");
});

// ---------------- a real SMTP server on this machine ----------------
async function smtpServer(user = "me@x.com", pass = "pw") {
  const got: any[] = [];
  const server = new SMTPServer({ authOptional: false, disabledCommands: ["STARTTLS"], allowInsecureAuth: true, logger: false,
    onAuth(a, _s, cb) { a.username === user && a.password === pass ? cb(null, { user: 1 }) : cb(new Error("Invalid credentials")); },
    onData(stream, _s, cb) { simpleParser(stream).then((m) => { got.push(m); cb(); }, cb); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { got, port: (server.server.address() as any).port as number, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const local = { resolve: async () => ({ ip: "127.0.0.1", servername: "smtp.x.com" }), ignoreTLS: true };

test("a reply really goes out over SMTP, threaded to the message it answers", async () => {
  const s = await smtpServer(); const c = { email: "me@x.com", password: "pw", smtp_host: "smtp.x.com", smtp_port: String(s.port), name: 'Dan "Boss" Cohen' };
  try {
    await verifySmtp(c, local);
    const r = await sendMail(c, { to: "maya@lp.com", subject: "Re: UK numbers\r\nBcc: spy@evil.com", text: "Numbers attached", inReplyTo: "<m40@x>" }, local);
    assert.match(r.messageId, /^<.+@.+>$/); assert.equal(s.got.length, 1);
    const m = s.got[0];
    assert.equal(m.to.value[0].address, "maya@lp.com"); assert.equal(m.from.value[0].address, "me@x.com"); assert.equal(m.from.value[0].name, "Dan Boss Cohen", "quotes in the display name are removed");
    assert.equal(m.subject, "Re: UK numbers Bcc: spy@evil.com", "a newline in the subject cannot add a header"); assert.ok(!m.headers.get("bcc"), "no injected Bcc");
    assert.equal(m.text.trim(), "Numbers attached"); assert.equal(m.inReplyTo, "<m40@x>"); assert.deepEqual([].concat(m.references), ["<m40@x>"]);
  } finally { await s.close(); }
});
test("sending refuses bad recipients, wrong passwords and internal servers", async () => {
  const s = await smtpServer(); const c = { email: "me@x.com", password: "pw", smtp_host: "smtp.x.com", smtp_port: String(s.port) };
  try {
    for (const to of ["a@b.com\r\nBcc: x@y.com", "a@b.com, c@d.com", "not-an-address", '"quoted"@x.com', ""]) await assert.rejects(sendMail(c, { to, subject: "s", text: "t" }, local), /valid email/, JSON.stringify(to));
    await assert.rejects(sendMail({ ...c, password: "wrong" }, { to: "a@b.com", subject: "s", text: "t" }, local), /rejected the sign-in/);
    await assert.rejects(verifySmtp({ ...c, password: "wrong" }, local), /rejected the sign-in/);
    await assert.rejects(sendMail({ ...c, smtp_host: "10.0.0.5" }, { to: "a@b.com", subject: "s", text: "t" }), /not allowed/);
    assert.equal(s.got.length, 0, "nothing was delivered by any of those");
  } finally { await s.close(); }
  assert.equal(isMailbox("maya.levi+x@lucky-partners.co.uk"), true);
});

// ---------------- the real mail parser on a realistic message ----------------
test("a real RFC 822 message (quoted reply, attachment) becomes one clean chat message", async () => {
  const raw = ["From: Maya Levi <maya@luckypartners.com>", "To: me@x.com", "Subject: Re: UK numbers", "Message-ID: <real-1@luckypartners.com>", "Date: Tue, 03 Nov 2026 10:05:00 +0000", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="B"', "",
    "--B", "Content-Type: text/plain; charset=utf-8", "", "Thanks, invoice attached.", "", "On Mon, 2 Nov 2026 at 09:00, me <me@x.com> wrote:", "> Can you send the invoice?", "", "--B", 'Content-Type: application/pdf; name="INV-1042.pdf"', 'Content-Disposition: attachment; filename="INV-1042.pdf"', "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQK", "--B--", ""].join("\r\n");
  const parsed = await simpleParser(Buffer.from(raw));
  const r = toInbound(parsed as any, "me@x.com", "f") as any;
  assert.equal(r.msg.body, "Thanks, invoice attached."); assert.equal(r.msg.subject, "Re: UK numbers"); assert.equal(r.msg.externalId, "<real-1@luckypartners.com>");
  assert.equal(r.msg.externalConversationId, "maya@luckypartners.com"); assert.deepEqual(r.msg.attachments, [{ name: "INV-1042.pdf", kind: "application/pdf" }]); assert.equal(r.msg.sentAt, "2026-11-03T10:05:00.000Z");
});
