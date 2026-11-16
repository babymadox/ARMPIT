import { test } from "node:test";
import assert from "node:assert/strict";
import { detectProvider, domainOf } from "../src/lib/email/presets.ts";
import { isPublicIp, resolvePublic } from "../src/lib/email/net.ts";
import { htmlToText, stripQuoted, replySubject, isAutomated, toInbound } from "../src/lib/email/parse.ts";

test("any address is recognised: known providers get their servers, other domains get editable guesses", () => {
  assert.equal(detectProvider("Ann@Gmail.com").imap.host, "imap.gmail.com");
  assert.equal(detectProvider("x@googlemail.com").id, "gmail"); assert.equal(detectProvider("x@hotmail.com").id, "outlook"); assert.equal(detectProvider("x@icloud.com").smtp.port, 587);
  const own = detectProvider("sam@lucky-affiliates.com");
  assert.deepEqual([own.id, own.imap.host, own.imap.port, own.smtp.host], ["custom", "imap.lucky-affiliates.com", 993, "smtp.lucky-affiliates.com"]);
  assert.equal(domainOf("  A@B.co "), "b.co");
});

test("internal addresses are refused so a typed-in mail host cannot reach the server's own network", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.5", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.5", "224.0.0.1"]) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "142.250.80.5", "172.32.0.1", "2607:f8b0:4004:c1b::6a"]) assert.equal(isPublicIp(ip), true, ip);
  assert.equal(isPublicIp("not an ip"), false);
});
test("a host name is resolved and every answer must be public; the checked IP is what gets used", async () => {
  const ok = await resolvePublic("imap.gmail.com", async () => [{ address: "142.250.1.109" }, { address: "142.250.1.108" }]);
  assert.deepEqual(ok, { ip: "142.250.1.109", servername: "imap.gmail.com" });
  await assert.rejects(resolvePublic("evil.example.com", async () => [{ address: "8.8.8.8" }, { address: "169.254.169.254" }]), /not allowed/, "one private answer is enough to refuse (DNS rebinding)");
  await assert.rejects(resolvePublic("localhost", async () => []), /not allowed/);
  await assert.rejects(resolvePublic("db.internal", async () => []), /not allowed/);
  await assert.rejects(resolvePublic("127.0.0.1", async () => []), /not allowed/);
  await assert.rejects(resolvePublic("bad host!", async () => []), /not valid/);
  await assert.rejects(resolvePublic("nx.example.com", async () => { throw new Error("ENOTFOUND"); }), /Could not find/);
  assert.equal((await resolvePublic("127.0.0.1", async () => [], true)).ip, "127.0.0.1", "tests can opt in to loopback");
});

test("replies show only what was just written", () => {
  assert.equal(stripQuoted("Sounds good, thanks!\n\nOn Mon, 3 Nov 2026 at 10:00, Maya <m@x.com> wrote:\n> Can we get the numbers?\n> Thanks"), "Sounds good, thanks!");
  assert.equal(stripQuoted("Yes.\n\n-----Original Message-----\nFrom: a\nSent: b\nOld text"), "Yes.");
  assert.equal(stripQuoted("Done\n\nFrom: Maya Levi\nSent: Monday\nTo: me\nSubject: numbers\nold"), "Done");
  assert.equal(stripQuoted("Line one\n> quoted bit\nmore"), "Line one");
  assert.equal(stripQuoted("> only a quote"), "> only a quote", "never returns an empty body");
  assert.equal(stripQuoted("Plain message with no history"), "Plain message with no history");
});
test("html mail becomes readable text", () => {
  assert.equal(htmlToText("<style>p{x}</style><p>Hello&nbsp;<b>Maya</b></p><p>1 &lt; 2 &amp; 3</p><script>alert(1)</script>"), "Hello Maya\n1 < 2 & 3");
});
test("reply subjects", () => { assert.equal(replySubject("Numbers"), "Re: Numbers"); assert.equal(replySubject("RE: Numbers"), "RE: Numbers"); assert.equal(replySubject("Aw: x"), "Aw: x"); assert.equal(replySubject(""), "Re: (no subject)"); assert.equal(replySubject("a\r\nBcc: x@y"), "Re: a Bcc: x@y", "no header injection through the subject"); });
test("automated mail is recognised", () => {
  const h = (o: Record<string, string>) => (n: string) => o[n.toLowerCase()];
  assert.equal(isAutomated(h({ "auto-submitted": "auto-generated" }), "a@b.com"), true); assert.equal(isAutomated(h({ "auto-submitted": "no" }), "a@b.com"), false);
  assert.equal(isAutomated(h({ precedence: "bulk" }), "a@b.com"), true); assert.equal(isAutomated(h({ "list-id": "<x.y>" }), "a@b.com"), true);
  for (const a of ["noreply@x.com", "no-reply@x.com", "Do-Not-Reply@x.com", "mailer-daemon@x.com", "notifications@github.com", "bounces+123@x.com"]) assert.equal(isAutomated(h({}), a), true, a);
  assert.equal(isAutomated(h({}), "maya.levi@luckypartners.com"), false);
});
const mail = (o: any = {}) => ({ from: { value: [{ name: "Maya Levi", address: "Maya@LuckyPartners.com" }] }, subject: "UK numbers", text: "Here you go\n\nOn Mon, 3 Nov 2026 at 10:00, me wrote:\n> hi", messageId: "<abc@mx>", date: new Date("2026-11-03T10:05:00Z"), attachments: [], headers: new Map(), ...o });
test("a mail becomes one chat message keyed by the sender", () => {
  const r = toInbound(mail(), "me@x.com", "uid:1:5") as any;
  assert.deepEqual(r.msg, { externalConversationId: "maya@luckypartners.com", externalId: "<abc@mx>", title: "Maya Levi", sender: "Maya Levi", subject: "UK numbers", body: "Here you go", sentAt: "2026-11-03T10:05:00.000Z", attachments: [] });
});
test("mail that should not be imported is skipped, with the reason", () => {
  assert.deepEqual(toInbound(mail({ from: { value: [{ address: "ME@x.com" }] } }), "me@x.com", "f"), { skip: "self" });
  assert.deepEqual(toInbound(mail({ from: { value: [] } }), "me@x.com", "f"), { skip: "no_sender" });
  assert.deepEqual(toInbound(mail({ headers: new Map([["list-id", "<x>"]]) }), "me@x.com", "f"), { skip: "automated" });
  assert.deepEqual(toInbound(mail({ from: { value: [{ address: "noreply@shop.com" }] } }), "me@x.com", "f"), { skip: "automated" });
});
test("odd mail still imports sensibly", () => {
  const html = toInbound(mail({ text: "", html: "<p>Hi <b>there</b></p>", messageId: undefined, subject: undefined }), "me@x.com", "uid:9:42") as any;
  assert.equal(html.msg.body, "Hi there"); assert.equal(html.msg.externalId, "uid:9:42"); assert.equal(html.msg.subject, "(no subject)"); assert.equal(html.msg.title, "Maya Levi");
  const att = toInbound(mail({ text: "", attachments: [{ filename: "IO.pdf", contentType: "application/pdf" }] }), "me@x.com", "f") as any;
  assert.equal(att.msg.body, "📎 IO.pdf"); assert.deepEqual(att.msg.attachments, [{ name: "IO.pdf", kind: "application/pdf" }]);
  assert.equal((toInbound(mail({ text: "", html: false }), "me@x.com", "f") as any).msg.body, "(no text)");
  const bad = toInbound(mail({ date: new Date("nope") }), "me@x.com", "f", new Date("2026-01-01T00:00:00Z")) as any; assert.equal(bad.msg.sentAt, "2026-01-01T00:00:00.000Z");
  assert.equal((toInbound(mail({ text: "x".repeat(30_000) }), "me@x.com", "f") as any).msg.body.length, 20_000);
});
