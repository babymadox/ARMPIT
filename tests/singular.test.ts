import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSingular } from "../src/lib/integrations/trackers/singular.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function fakeSingular(opts: { fail?: boolean } = {}) {
  const calls: { url: string; method: string; auth: string | null; body: string }[] = [];
  let polls = 0;
  const f = async (input: any, init: any = {}) => {
    const url = String(input), h = new Headers(init.headers);
    calls.push({ url, method: init.method ?? "GET", auth: h.get("authorization"), body: String(init.body ?? "") });
    if (url.includes("reporting/filters")) return json({ value: { dimensions: [] } });
    if (url.includes("create_async_report")) return json({ status: 0, value: { report_id: "r1" } });
    if (url.includes("get_report_status")) {
      polls++;
      if (opts.fail) return json({ value: { report_id: "r1", status: "FAILED", error_message: "bad metric" } });
      return json({ value: polls < 3 ? { report_id: "r1", status: polls === 1 ? "QUEUED" : "STARTED" } : { report_id: "r1", status: "DONE", download_url: "https://files.example/r1.json" } });
    }
    if (url.startsWith("https://files.example/")) return json({ results: [
      { source: "Facebook", agency_name: "Viking Media", start_date: "2026-11-12", end_date: "2026-11-12", custom_installs: 12, custom_clicks: 300, adn_cost: 55.5, revenue: null },
      { source: "Facebook", agency_name: "Velocity Ads", start_date: "2026-11-12", end_date: "2026-11-12", custom_installs: 3 },
      { source: "Unity", agency_name: "Viking Media", start_date: "2026-11-13", end_date: "2026-11-13", custom_installs: 4 },
      { source: "", agency_name: "Viking Media", start_date: "2026-11-13", custom_installs: 9 },
    ] });
    return json({}, 404);
  };
  return { f: f as typeof fetch, calls };
}

test("fetchStats runs the async flow and maps rows per source/day/metric", async () => {
  const { f, calls } = fakeSingular();
  const rows = await makeSingular({ fetch: f, pollMs: 0 }).fetchStats({ api_key: "K" }, "2026-11-12", "2026-11-13");
  const byMetric = <T extends { metric: string }>(r: T[]) => [...r].sort((a, b) => a.metric.localeCompare(b.metric));
  assert.deepEqual(byMetric(rows.filter((r) => r.externalId === "Facebook" && r.group === "Viking Media")).map((r) => [r.metric, r.value]),
    [["adn_cost", 55.5], ["custom_clicks", 300], ["custom_installs", 12]]);
  assert.equal(rows.some((r) => r.metric === "revenue"), false, "null metrics are skipped");
  assert.equal(rows.some((r) => r.externalId === ""), false, "rows without a source are skipped");
  assert.equal(rows.find((r) => r.externalId === "Unity")?.day, "2026-11-13");
  const shared = rows.filter((r) => r.externalId === "Facebook" && r.metric === "custom_installs");
  assert.deepEqual(shared.map((r) => [r.group, r.value]).sort(), [["Velocity Ads", 3], ["Viking Media", 12]], "one source, two agencies, separate numbers");
  assert.ok(rows.every((r) => r.group !== undefined));
  const create = calls.find((c) => c.url.includes("create_async_report"))!;
  assert.equal(create.method, "POST");
  assert.equal(create.auth, "K", "api key goes in the Authorization header");
  const p = new URLSearchParams(create.body);
  assert.equal(p.get("start_date"), "2026-11-12"); assert.equal(p.get("time_breakdown"), "day"); assert.equal(p.get("format"), "json");
  assert.ok(p.get("metrics")!.includes("custom_installs"));
  assert.equal(p.get("dimensions"), "source,agency_name");
  assert.equal(calls.filter((c) => c.url.includes("get_report_status")).length, 3, "polls through QUEUED and STARTED until DONE");
  assert.equal(calls.at(-1)!.auth, null, "pre-signed download URL gets no Authorization header");
});

test("a FAILED report surfaces Singular's error message", async () => {
  const { f } = fakeSingular({ fail: true });
  await assert.rejects(makeSingular({ fetch: f, pollMs: 0 }).fetchStats({ api_key: "K" }, "2026-11-12", "2026-11-12"), /bad metric/);
});

test("test() validates the key with a cheap call, and reports bad keys", async () => {
  const ok = fakeSingular();
  assert.deepEqual(await makeSingular({ fetch: ok.f }).test({ api_key: "K" }), { ok: true });
  assert.equal((await makeSingular({ fetch: (async () => json({}, 401)) as typeof fetch }).test({ api_key: "bad" })).ok, false);
  assert.equal((await makeSingular({ fetch: ok.f }).test({})).ok, false);
});

test("a hung Singular fails with a clear message instead of hanging", async () => {
  const hung = (async () => { const e = new Error("aborted"); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
  assert.deepEqual(await makeSingular({ fetch: hung }).test({ api_key: "K" }), { ok: false, error: "Singular did not respond in time" });
  await assert.rejects(makeSingular({ fetch: hung, pollMs: 0 }).fetchStats({ api_key: "K" }, "2026-11-12", "2026-11-12"), /did not respond in time/);
});
