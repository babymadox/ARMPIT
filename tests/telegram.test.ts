import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTelegram, MAX_TEXT } from "../src/lib/integrations/channels/telegram.ts";

const creds = { bot_token: "123:ABC", webhook_secret: "s3cret" };
const hook = (update: unknown, secret = "s3cret") => new Request("https://x.test/api/webhooks/telegram?c=1", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(update) });
const base = { message_id: 7, date: 1794700000, chat: { id: -1001, type: "supergroup", title: "Viking Media × us" }, from: { id: 5, first_name: "Maya", last_name: "Levi", is_bot: false } };
const tg = makeTelegram();

test("a group text message becomes one inbound message", async () => {
  const [m] = await tg.parseWebhook(hook({ update_id: 1, message: { ...base, text: "Can we get UK numbers?" } }), creds);
  assert.deepEqual(m, { externalConversationId: "-1001", externalId: "7", title: "Viking Media × us", sender: "Maya Levi", body: "Can we get UK numbers?", sentAt: new Date(1794700000 * 1000).toISOString(), attachments: [] });
});
test("wrong or missing webhook secret is rejected", async () => {
  await assert.rejects(tg.parseWebhook(hook({ message: { ...base, text: "hi" } }, "nope"), creds), /bad webhook secret/);
  await assert.rejects(tg.parseWebhook(hook({ message: { ...base, text: "hi" } }), { bot_token: "x" }), /bad webhook secret/);
});
test("bot senders, edits and service messages are ignored", async () => {
  assert.deepEqual(await tg.parseWebhook(hook({ message: { ...base, from: { id: 9, first_name: "B", is_bot: true }, text: "x" } }), creds), []);
  assert.deepEqual(await tg.parseWebhook(hook({ edited_message: { ...base, text: "x" } }), creds), []);
  assert.deepEqual(await tg.parseWebhook(hook({ message: { ...base, new_chat_members: [{ id: 1 }] } }), creds), []);
  assert.deepEqual(await tg.parseWebhook(hook("not an update"), creds), []);
});
test("media without text gets a readable label and an attachment record", async () => {
  const [d] = await tg.parseWebhook(hook({ message: { ...base, document: { file_name: "IO_2026.pdf" } } }), creds);
  assert.equal(d.body, "📎 IO_2026.pdf"); assert.deepEqual(d.attachments, [{ name: "IO_2026.pdf", kind: "document" }]);
  const [p] = await tg.parseWebhook(hook({ message: { ...base, photo: [{}], caption: "Creative v2" } }), creds);
  assert.equal(p.body, "📷 Photo\nCreative v2");
});
test("a private chat is titled by the person's name", async () => {
  const [m] = await tg.parseWebhook(hook({ message: { ...base, chat: { id: 55, type: "private", first_name: "Sara", last_name: "Klein" }, text: "hello" } }), creds);
  assert.equal(m.title, "Sara Klein"); assert.equal(m.externalConversationId, "55");
});

function fakeApi(responses: Record<string, unknown>) {
  const calls: { method: string; body: any }[] = [];
  const f = (async (url: string, init: any) => { const method = String(url).split("/").pop()!; calls.push({ method, body: JSON.parse(init.body) });
    const r: any = responses[method]; return new Response(JSON.stringify(r.body ?? { ok: true, result: r }), { status: r.status ?? 200 }); }) as unknown as typeof fetch;
  return { f, calls };
}
test("connect validates the token, then registers the webhook with a secret", async () => {
  const { f, calls } = fakeApi({ getMe: { id: 1, is_bot: true, username: "armpit_bot" }, setWebhook: true });
  const r = await makeTelegram({ fetch: f, secret: () => "SECRET" }).connect({ bot_token: "123:ABC" }, "https://app.test/api/webhooks/telegram?c=9");
  assert.deepEqual(r, { account: "@armpit_bot", creds: { bot_token: "123:ABC", webhook_secret: "SECRET" } });
  assert.deepEqual(calls.map((c) => c.method), ["getMe", "setWebhook"]);
  assert.deepEqual(calls[1].body, { url: "https://app.test/api/webhooks/telegram?c=9", secret_token: "SECRET", allowed_updates: ["message"] });
});
test("connect surfaces Telegram's error for a bad token and never registers a webhook", async () => {
  const { f, calls } = fakeApi({ getMe: { status: 401, body: { ok: false, description: "Unauthorized" } } });
  await assert.rejects(makeTelegram({ fetch: f }).connect({ bot_token: "bad" }, "https://x"), /Telegram: Unauthorized/);
  assert.deepEqual(calls.map((c) => c.method), ["getMe"]);
});
test("send posts plain text to the chat and returns the message id; errors and oversize are rejected", async () => {
  const { f, calls } = fakeApi({ sendMessage: { message_id: 42 } });
  assert.deepEqual(await makeTelegram({ fetch: f }).send(creds, "-1001", "Numbers attached"), { externalId: "42" });
  assert.deepEqual(calls[0].body, { chat_id: "-1001", text: "Numbers attached" });
  await assert.rejects(makeTelegram({ fetch: f }).send(creds, "-1001", "x".repeat(MAX_TEXT + 1)), /limited to 4096/);
  await assert.rejects(makeTelegram({ fetch: f }).send(creds, "-1001", "  "), /empty/);
  const bad = fakeApi({ sendMessage: { status: 403, body: { ok: false, description: "Forbidden: bot was kicked from the group chat" } } });
  await assert.rejects(makeTelegram({ fetch: bad.f }).send(creds, "-1001", "hi"), /bot was kicked/);
});
test("status flags a webhook that points elsewhere or reports delivery errors", async () => {
  const mk = (info: object) => makeTelegram({ fetch: fakeApi({ getWebhookInfo: { pending_update_count: 0, ...info } }).f });
  assert.equal((await mk({ url: "https://app.test/h" }).status(creds, "https://app.test/h")).ok, true);
  assert.equal((await mk({ url: "https://other" }).status(creds, "https://app.test/h")).ok, false);
  assert.match((await mk({ url: "https://app.test/h", last_error_message: "Connection timed out" }).status(creds, "https://app.test/h")).detail, /timed out/);
});

test("a hung Telegram fails fast with a clear message, and every call carries a timeout", async () => {
  const signals: (AbortSignal | undefined)[] = [];
  const hung = (async (_u: string, init: any) => { signals.push(init.signal); const e = new Error("aborted"); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
  await assert.rejects(makeTelegram({ fetch: hung }).send(creds, "1", "hi"), /Telegram did not respond in time/);
  assert.equal((await makeTelegram({ fetch: hung }).status(creds, "https://x")).detail, "Telegram did not respond in time");
  assert.ok(signals.length === 2 && signals.every((s) => s instanceof AbortSignal), "timeout signal passed on every call");
  const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(makeTelegram({ fetch: down }).send(creds, "1", "hi"), /Could not reach Telegram/);
});
