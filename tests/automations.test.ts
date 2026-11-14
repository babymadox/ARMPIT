import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoffFor, runAutomations } from "../src/lib/automations.ts";

/** Minimal in-memory stand-in for the supabase-js query builder, covering only what the job uses. */
function fakeDb(tables: Record<string, any[]>, failInsertFor?: string) {
  const db: any = { tables, from(name: string) {
    const filters: ((r: any) => boolean)[] = []; let op: "select" | "insert" | "update" = "select"; let payload: any; let lim = Infinity;
    const b: any = {
      select() { return b; }, limit(n: number) { lim = n; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; }, neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      lt(c: string, v: any) { filters.push((r) => r[c] != null && r[c] < v); return b; },
      not(c: string, _o: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      insert(row: any) { op = "insert"; payload = row; return b; }, update(v: any) { op = "update"; payload = v; return b; },
      then(res: any, rej: any) {
        try {
          const t = (tables[name] ??= []);
          if (op === "insert") { if (failInsertFor && payload.org_id === failInsertFor) return res({ data: null, error: { message: "insert blocked" } }); t.push({ id: `${name}${t.length + 1}`, status: "open", ...payload }); return res({ data: null, error: null }); }
          const hit = t.filter((r) => filters.every((f) => f(r)));
          if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return res({ data: null, error: null }); }
          return res({ data: hit.slice(0, lim), error: null });
        } catch (e) { return rej(e); }
      },
    }; return b;
  } }; return db;
}
const NOW = Date.parse("2026-11-14T00:00:00Z"), old = "2026-11-01T00:00:00Z", fresh = "2026-11-13T00:00:00Z";
const mk = (extra: any = {}) => ({
  automations: [
    { id: "a1", org_id: "o1", name: "Silent partner", enabled: true, runs: 10, trigger: { type: "no_message", days: 3 } },
    { id: "a2", org_id: "o2", name: "Silent partner", enabled: true, runs: 0, trigger: { type: "no_message", days: 3 } },
    ...(extra.autos ?? []),
  ],
  conversations: [
    { org_id: "o1", partner_id: "p1", owner_id: "m1", last_message_at: old }, { org_id: "o1", partner_id: "p2", owner_id: "m1", last_message_at: old },
    { org_id: "o1", partner_id: "p3", owner_id: "m1", last_message_at: old }, { org_id: "o1", partner_id: "p4", owner_id: "m1", last_message_at: fresh },
    { org_id: "o2", partner_id: "q1", owner_id: "n1", last_message_at: old }, { org_id: "o2", partner_id: "q2", owner_id: "n1", last_message_at: old },
  ],
  tasks: [],
});

test("each automation counts its own tasks (was cumulative: 3 then 5)", async () => {
  const db = fakeDb(mk());
  const r = await runAutomations(db, NOW);
  assert.deepEqual(r.map((x) => [x.id, x.fired]), [["a1", 3], ["a2", 2]]);
  assert.equal(db.tables.automations.find((a: any) => a.id === "a1").runs, 13);
  assert.equal(db.tables.automations.find((a: any) => a.id === "a2").runs, 2);
});
test("tasks never cross workspaces", async () => {
  const db = fakeDb(mk()); await runAutomations(db, NOW);
  assert.ok(db.tables.tasks.filter((t: any) => t.org_id === "o1").every((t: any) => t.partner_id.startsWith("p")));
  assert.ok(db.tables.tasks.filter((t: any) => t.org_id === "o2").every((t: any) => t.partner_id.startsWith("q")));
});
test("a malformed trigger is skipped and does not stop the other workspaces", async () => {
  const db = fakeDb(mk({ autos: [{ id: "bad", org_id: "o1", name: "Broken", enabled: true, runs: 0, trigger: { type: "no_message" } }, { id: "bad2", org_id: "o1", name: "Odd", enabled: true, runs: 0, trigger: null }] }));
  const r = await runAutomations(db, NOW);
  assert.equal(r.find((x) => x.id === "bad")!.skipped, "unsupported or invalid trigger");
  assert.equal(r.find((x) => x.id === "bad2")!.skipped, "unsupported or invalid trigger");
  assert.equal(r.find((x) => x.id === "a2")!.fired, 2, "later automations still run");
});
test("a failing workspace is reported and isolated", async () => {
  const db = fakeDb(mk(), "o1");
  const r = await runAutomations(db, NOW);
  assert.match(r.find((x) => x.id === "a1")!.error!, /insert blocked/);
  assert.equal(r.find((x) => x.id === "a2")!.fired, 2);
});
test("running twice creates no duplicate follow-ups; a partner with two quiet chats gets one task", async () => {
  const data = mk(); data.conversations.push({ org_id: "o1", partner_id: "p1", owner_id: "m1", last_message_at: old });
  const db = fakeDb(data);
  await runAutomations(db, NOW); const first = db.tables.tasks.length;
  const r2 = await runAutomations(db, NOW);
  assert.equal(first, 5, "p1 once, p2, p3, q1, q2"); assert.equal(db.tables.tasks.length, first); assert.deepEqual(r2.map((x) => x.fired), [0, 0]);
});
test("cutoffFor never throws", () => {
  assert.equal(cutoffFor({ type: "no_message", days: 3 }, NOW), "2026-11-11T00:00:00.000Z");
  for (const t of [null, undefined, {}, { type: "no_message" }, { type: "no_message", days: "x" }, { type: "no_message", days: -1 }, { type: "other", days: 3 }]) assert.equal(cutoffFor(t, NOW), null);
  assert.equal(cutoffFor({ type: "no_message", days: "2" }, NOW), "2026-11-12T00:00:00.000Z", "numeric strings are accepted");
});
