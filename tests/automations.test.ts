import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoffFor, runAutomations, humanize, weekKey, silentPartners, noReplyChats, capHits, dropHits } from "../src/lib/automations.ts";

/** Minimal in-memory stand-in for the supabase-js query builder, covering only what the job uses. */
function fakeDb(tables: Record<string, any[]>, opts: { failInsertFor?: string; rpc?: Record<string, (a: any) => any[]> } = {}) {
  const db: any = {
    tables,
    rpc(name: string, args: any) { const f = opts.rpc?.[name]; return Promise.resolve(f ? { data: f(args), error: null } : { data: null, error: { message: `no rpc ${name}` } }); },
    from(name: string) {
      const filters: ((r: any) => boolean)[] = []; let op: "select" | "insert" | "update" | "upsert" = "select"; let payload: any; let lim = Infinity; let uopts: any = {};
      const b: any = {
        select() { return b; }, limit(n: number) { lim = n; return b; },
        eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; }, neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
        lt(c: string, v: any) { filters.push((r) => r[c] != null && r[c] < v); return b; }, in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
        not(c: string, _o: string, v: any) { filters.push((r) => r[c] !== v); return b; },
        insert(row: any) { op = "insert"; payload = row; return b; }, update(v: any) { op = "update"; payload = v; return b; },
        upsert(row: any, o: any) { op = "upsert"; payload = row; uopts = o ?? {}; return b; },
        then(res: any, rej: any) {
          try {
            const t = (tables[name] ??= []);
            if (op === "insert") { if (opts.failInsertFor && payload.org_id === opts.failInsertFor) return res({ data: null, error: { message: "insert blocked" } }); const row = { id: `${name}${t.length + 1}`, status: "open", ...payload }; t.push(row); return res({ data: [row], error: null }); }
            if (op === "upsert") { const cols = String(uopts.onConflict).split(","); const dup = t.some((r) => cols.every((c) => r[c] === payload[c] && payload[c] != null)); if (dup) return res({ data: [], error: null }); const row = { id: `${name}${t.length + 1}`, ...payload }; t.push(row); return res({ data: [row], error: null }); }
            const hit = t.filter((r) => filters.every((f) => f(r)));
            if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return res({ data: null, error: null }); }
            return res({ data: hit.slice(0, lim), error: null });
          } catch (e) { return rej(e); }
        },
      }; return b;
    },
  };
  return db;
}
const NOW = Date.parse("2026-11-14T12:00:00Z"), old = "2026-11-01T00:00:00Z", fresh = "2026-11-13T00:00:00Z";
const conv = (o: any) => ({ id: "c" + Math.random().toString(36).slice(2, 6), title: "Chat", partner_id: null, owner_id: "m1", last_inbound_at: old, created_at: old, last_message_at: old, last_direction: "in", ...o });
const auto = (o: any) => ({ id: "a1", org_id: "o1", name: "Silent partner", enabled: true, runs: 10, actions: [{ type: "create_task" }, { type: "notify", who: "owner" }], trigger: { type: "no_message", days: 3 }, ...o });

test("silent partner: counted only when NO chat of the partner has heard from them (was: any quiet chat)", () => {
  const hits = silentPartners([
    conv({ partner_id: "p1", owner_id: "m1" }), conv({ partner_id: "p1", last_inbound_at: fresh }),     // p1 active in one chat -> not silent
    conv({ partner_id: "p2", owner_id: "m2" }), conv({ partner_id: "p3", last_inbound_at: null, created_at: fresh }),   // p3 never wrote but the chat is new
    conv({ partner_id: null }),
  ], cutoffFor({ type: "no_message", days: 3 }, NOW)!, "Silent partner");
  assert.deepEqual(hits.map((h) => [h.partnerId, h.ownerId]), [["p2", "m2"]]);
  assert.equal(hits[0].title, "Silent partner: follow up");
});
test("no reply: our message is the last one and it is old", () => {
  const hits = noReplyChats([conv({ id: "x", last_direction: "out" }), conv({ id: "y", last_direction: "in" }), conv({ id: "z", last_direction: "out", last_message_at: fresh })], cutoffFor({ type: "no_reply", days: 2 }, NOW)!);
  assert.deepEqual(hits.map((h) => h.key), ["noreply:x"]);
});
test("cap: only live deals at or over the threshold, and never divides by zero", () => {
  const d = (o: any) => ({ id: "d", partner_id: "p", owner_id: "m", brand: "B", cap: 100, progress: 95, status: "live", ...o });
  assert.equal(capHits([d({}), d({ id: "e", progress: 89 }), d({ id: "f", status: "ended" }), d({ id: "g", cap: null }), d({ id: "h", cap: 0 })], 90).length, 1);
});
test("volume drop: needs enough previous volume, and a real drop", () => {
  const names = new Map([["p1", { owner: "m1", name: "Viking" }], ["p2", { owner: null, name: "Tiny" }], ["p3", { owner: "m3", name: "Steady" }]]);
  const hits = dropHits(new Map([["p1", 40], ["p3", 95]]), new Map([["p1", 100], ["p2", 10], ["p3", 100]]), 30, 20, names, "custom_installs", 7);
  assert.deepEqual(hits.map((h) => h.partnerId), ["p1"]);
  assert.match(hits[0].body, /40 vs 100.*−60%/);
});

test("end to end: tasks and notifications are created once, then not again the same week", async () => {
  const db = fakeDb({ automations: [auto({})], members: [{ id: "m1", org_id: "o1", status: "active", role: "member" }, { id: "adm", org_id: "o1", status: "active", role: "admin" }],
    conversations: [conv({ org_id: "o1", partner_id: "p1", owner_id: "m1" }), conv({ org_id: "o1", partner_id: "p2", owner_id: "m1" }), conv({ org_id: "o1", partner_id: "p3", last_inbound_at: new Date(NOW + 7 * 864e5).toISOString() })], tasks: [], notifications: [] });   // p3 stays active through the whole timeline
  const r1 = await runAutomations(db, NOW);
  assert.deepEqual(r1, [{ id: "a1", fired: 2 }]);
  assert.equal(db.tables.tasks.length, 2); assert.equal(db.tables.notifications.length, 2);
  assert.ok(db.tables.notifications.every((n: any) => n.member_id === "m1" && n.href.startsWith("/partners/")));
  const r2 = await runAutomations(db, NOW + 3600e3);
  assert.deepEqual(r2, [{ id: "a1", fired: 0 }], "same week, same condition: no duplicates"); assert.equal(db.tables.tasks.length, 2);
  assert.equal(db.tables.automations[0].runs, 12);
  const r3 = await runAutomations(db, NOW + 8 * 864e5);
  assert.equal(r3[0].fired, 2, "a persisting condition re-notifies the next week (task already open, so only notifications)");
  assert.equal(db.tables.tasks.length, 2); assert.equal(db.tables.notifications.length, 4);
});
test("notify admins when the partner has no owner", async () => {
  const db = fakeDb({ automations: [auto({ actions: [{ type: "notify", who: "owner" }] })], members: [{ id: "adm", org_id: "o1", status: "active", role: "owner_admin" }, { id: "pending", org_id: "o1", status: "invited", role: "admin" }],
    conversations: [conv({ org_id: "o1", partner_id: "p1", owner_id: null })], tasks: [], notifications: [] });
  await runAutomations(db, NOW);
  assert.deepEqual(db.tables.notifications.map((n: any) => n.member_id), ["adm"], "active admins only");
});
test("volume drop runs through the database aggregates", async () => {
  const rpc = { partner_metric_sums: (a: any) => (a.p_from >= "2026-11-07" ? [{ partner_id: "p1", total: 30 }] : [{ partner_id: "p1", total: 100 }]) };
  const db = fakeDb({ automations: [auto({ id: "d1", trigger: { type: "metric_drop", pct: 30, days: 7 }, actions: [{ type: "notify", who: "owner" }] })], partners: [{ id: "p1", org_id: "o1", name: "Viking", owner_id: "m1" }], notifications: [] }, { rpc });
  const r = await runAutomations(db, NOW);
  assert.equal(r[0].fired, 1); assert.match(db.tables.notifications[0].title, /Volume drop: Viking/);
});
test("a malformed trigger is skipped; a failing workspace is reported; neither stops the others", async () => {
  const mk = () => fakeDb({ automations: [auto({ id: "bad", trigger: { type: "no_message" } }), auto({ id: "bad2", trigger: null }), auto({ id: "x", org_id: "o2" }), auto({ id: "ok", org_id: "o3" })],
    members: [], conversations: [conv({ org_id: "o2", partner_id: "q1" }), conv({ org_id: "o3", partner_id: "r1" })], tasks: [], notifications: [] }, { failInsertFor: "o2" });
  const r = await runAutomations(mk(), NOW);
  assert.equal(r.find((x) => x.id === "bad")!.skipped, "unsupported or invalid trigger"); assert.equal(r.find((x) => x.id === "bad2")!.skipped, "unsupported or invalid trigger");
  assert.match(r.find((x) => x.id === "x")!.error!, /insert blocked/); assert.equal(r.find((x) => x.id === "ok")!.fired, 1);
});
test("one workspace can be run on its own", async () => {
  const db = fakeDb({ automations: [auto({}), auto({ id: "a2", org_id: "o2" })], members: [], conversations: [conv({ org_id: "o1", partner_id: "p1" }), conv({ org_id: "o2", partner_id: "q1" })], tasks: [], notifications: [] });
  assert.deepEqual((await runAutomations(db, NOW, { orgId: "o2" })).map((r) => r.id), ["a2"]);
});
test("cutoffFor never throws; humanize and weekKey", () => {
  assert.equal(cutoffFor({ type: "no_message", days: 3 }, NOW), "2026-11-11T12:00:00.000Z");
  for (const t of [null, undefined, {}, { type: "no_message" }, { type: "no_reply", days: "x" }, { type: "no_message", days: -1 }, { type: "other", days: 3 }]) assert.equal(cutoffFor(t, NOW), null);
  assert.match(humanize({ type: "cap_pct", pct: 90 }), /90% of its cap/); assert.match(humanize({ type: "metric_drop", pct: 30, days: 7 }), /Installs falls 30%/); assert.equal(humanize(null), "Custom trigger");
  assert.equal(weekKey(Date.parse("2026-11-14T12:00:00Z")), "2026-W46"); assert.equal(weekKey(Date.parse("2026-01-01T00:00:00Z")), "2026-W1"); assert.equal(weekKey(Date.parse("2025-12-29T00:00:00Z")), "2026-W1");
});
