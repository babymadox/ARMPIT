import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub, scrubDetails, buildEventRow, errMsg } from "../src/lib/scrub.ts";
import { effective, nextActions, toMarkdown, type Report } from "../src/lib/report.ts";
import { FEATURES } from "../src/lib/features.ts";

test("secrets are redacted from messages", () => {
  const bot = "8123456789:AAH_FAKEabcdefghijklmnopqrstuvwxyz01";
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz";
  for (const [input, leaked] of [[`call /bot${bot}/sendMessage failed`, bot], [`Authorization: Bearer ${jwt}`, jwt], ["GET /x?api_key=SECRETVALUE123&a=1", "SECRETVALUE123"],
    ["key sb_secret_FAKEAbCdEf123456", "FAKEAbCdEf123456"], ["sk-FAKEabcdefghijklmnopqrstu", "FAKEabcdefghijklmnopqrstu"], ['{"password":"hunter2hunter2"}', "hunter2hunter2"]]) {
    const out = scrub(input); assert.ok(!out.includes(leaked), `leaked in: ${out}`);
  }
  assert.equal(scrub("Telegram: chat not found"), "Telegram: chat not found", "ordinary text is untouched");
  assert.ok(!errMsg(new Error(`bad token ${bot}`)).includes(bot));
});
test("event details never keep message text or credentials, and stay small", () => {
  const d = scrubDetails({ channel: "telegram", body: "private partner message", text: "x", bot_token: "123:abc", creds: { a: 1 }, n: 3, nested: { api_key: "k", ok: "fine" }, list: Array(50).fill("x") }) as any;
  assert.equal(d.body, "[omitted]"); assert.equal(d.text, "[omitted]"); assert.equal(d.bot_token, "[omitted]"); assert.equal(d.creds, "[omitted]");
  assert.equal(d.nested.api_key, "[omitted]"); assert.equal(d.nested.ok, "fine"); assert.equal(d.channel, "telegram"); assert.equal(d.list.length, 20);
  const row = buildEventRow({ level: "error", source: "x".repeat(200), message: "m".repeat(900), details: { big: "y".repeat(450), more: Array(30).fill("z".repeat(200)) } });
  assert.equal(row.source.length, 80); assert.equal(row.message.length, 500); assert.equal(row.org_id, null);
  assert.ok(JSON.stringify(row.details).length <= 4000);
});

const base = (over: Partial<Report> = {}): Report => ({
  generatedAt: "2026-11-16T10:00:00Z", app: { commit: "abc1234", env: "production", url: "armpit.vercel.app" },
  checks: [
    { id: "schema.delivery", group: "Database", label: "Message delivery columns (migration 7)", status: "fail", detail: "column missing", fix: "Run migration 7" },
    { id: "schema.sources", group: "Database", label: "Tracker sources (migration 5)", status: "ok" },
    { id: "env.cron", group: "Environment", label: "CRON_SECRET", status: "ok" },
  ],
  evidence: [{ id: "singular.sync", label: "Singular sync", at: "2026-11-15T03:00:00Z" }, { id: "telegram.inbound", label: "Telegram inbound", at: null }],
  counts: { partners: 12, conversations: null },
  events: [{ level: "error", source: "page:/inbox", message: "TypeError: Cannot read properties of null", digest: "1178203295", created_at: "2026-11-15T09:00:00Z", org_id: null }, { level: "info", source: "sync:singular", message: "ok", digest: null, created_at: "2026-11-15T03:00:00Z", org_id: "o" }],
  ...over,
});
const feat = (id: string) => FEATURES.find((f) => f.id === id)!;

test("a built feature whose requirement fails is reported blocked, with the reason", () => {
  const e = effective(feat("telegram.in"), base());
  assert.equal(e.status, "blocked"); assert.match(e.why!, /migration 7/);
});
test("built features are 'working' only with proof, otherwise 'built-unproven'", () => {
  const r = base({ checks: base().checks.map((c) => ({ ...c, status: "ok" as const })) });
  assert.equal(effective(feat("singular.sync"), r).status, "working");
  assert.equal(effective(feat("telegram.in"), r).status, "built-unproven");
  assert.equal(effective(feat("chan.gmail"), r).status, "not-built");
  assert.equal(effective(feat("deals"), r).status, "partial");
});
test("next actions list fixes first, then errors, with no duplicates", () => {
  const a = nextActions(base({ checks: [...base().checks, { id: "x", group: "Database", label: "dup", status: "fail", fix: "Run migration 7" }] }));
  assert.equal(a[0], "Run migration 7"); assert.equal(a.filter((x) => x === "Run migration 7").length, 1);
  assert.ok(a.some((x) => x.includes("page:/inbox") && x.includes("TypeError")));
});
test("the markdown report has every section, shows the digest, and carries no secrets", () => {
  const bot = "8123456789:AAH_FAKEabcdefghijklmnopqrstuvwxyz01";
  const md = toMarkdown(base({ events: [{ level: "error", source: "webhook", message: `failed for ${bot}`, digest: "1178203295", created_at: "t", org_id: null }] }));
  for (const h of ["# ARMPIT diagnostics", "## Next actions", "## Environment", "## Database", "## Features", "## Last proven working", "## Recent problems"]) assert.ok(md.includes(h), h);
  assert.ok(md.includes("digest 1178203295")); assert.ok(!md.includes(bot)); assert.ok(md.includes("never"), "unproven evidence says never");
});

test("every feature marked done has automatic proof or is flagged for a manual check", () => {
  for (const f of FEATURES.filter((f) => f.status === "done")) assert.ok(f.evidence || f.manual, `${f.id} is done with no way to prove it`);
});
test("a manual-check feature is never reported as working", () => {
  const r = base({ checks: base().checks.map((c) => ({ ...c, status: "ok" as const })) });
  const e = effective(feat("inbox.live"), r);
  assert.equal(e.status, "built-unproven"); assert.match(e.why!, /two windows/);
});
