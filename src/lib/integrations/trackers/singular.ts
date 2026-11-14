import type { MetricRow, TrackerAdapter } from "../types";

/**
 * Singular (MMP) via the Reporting API: create an async report, poll its status, download the rows.
 *
 * CONFIRMED from Singular's public docs (search results): async report creation is a POST to a v2.0
 * "create_async_report" endpoint, authenticated with an `api_key` query param, taking dimensions, metrics
 * and a date range, returning a report id that you poll via "Get Report Status" for a download link.
 *
 * NOT VERIFIED (docs host was unreachable when this was written): exact base URL, response field names,
 * the status string for a finished report, and the metric names. They are isolated in the constants below.
 * Verify them against a real Singular account before relying on this in production.
 */
const BASE = "https://api.singular.net/api/v2.0";
const DIMENSIONS = ["app", "source", "country_field"];               // VERIFY: field names
const METRICS = ["custom_impressions", "custom_clicks", "custom_installs"]; // VERIFY: add revenue / cost metrics your account exposes
const DONE = "DONE";                                                   // VERIFY
const POLL_MS = 3000, MAX_POLLS = 40;

type Creds = { api_key?: string };
const need = (c: Creds) => { if (!c.api_key) throw new Error("Singular api_key missing"); return c.api_key; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createReport(key: string, from: string, to: string): Promise<string> {
  const qs = new URLSearchParams({
    api_key: key, start_date: from, end_date: to, time_breakdown: "day", format: "json",
    dimensions: DIMENSIONS.join(","), metrics: METRICS.join(","),
  });
  const r = await fetch(`${BASE}/create_async_report?${qs}`, { method: "POST" });
  if (!r.ok) throw new Error(`Singular create_async_report ${r.status}`);
  const j = await r.json();
  const id = j?.value?.report_id ?? j?.report_id;                      // VERIFY
  if (!id) throw new Error("Singular: no report id in response");
  return String(id);
}

async function waitForUrl(key: string, id: string): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const r = await fetch(`${BASE}/get_report_status?${new URLSearchParams({ api_key: key, report_id: id })}`);
    if (!r.ok) throw new Error(`Singular get_report_status ${r.status}`);
    const j = await r.json(); const v = j?.value ?? j;                  // VERIFY
    if (v?.status === DONE && v?.download_url) return String(v.download_url);
    if (String(v?.status).toUpperCase() === "FAILED") throw new Error("Singular report failed");
    await wait(POLL_MS);
  }
  throw new Error("Singular report timed out");
}

export const singular: TrackerAdapter = {
  kind: "singular",

  async test(creds) {
    try {
      const key = need(creds), d = new Date().toISOString().slice(0, 10);
      await createReport(key, d, d);        // a successful create proves the key works
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  },

  /** Singular has no affiliate directory: partners are the `source` dimension, so list distinct sources from recent stats. */
  async listAffiliates(creds) {
    const to = new Date(), from = new Date(Date.now() - 30 * 864e5);
    const rows = await this.fetchStats(creds, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    return [...new Set(rows.map((r) => r.externalId))].map((s) => ({ externalId: s, name: s }));
  },

  /** externalId = Singular `source` (the partner/network). Metrics are stored exactly as Singular reports them. */
  async fetchStats(creds, from, to): Promise<MetricRow[]> {
    const key = need(creds);
    const url = await waitForUrl(key, await createReport(key, from, to));
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Singular download ${r.status}`);
    const body = await r.json();
    const rows: Record<string, unknown>[] = Array.isArray(body) ? body : body?.results ?? [];  // VERIFY
    const out: MetricRow[] = [];
    for (const row of rows) {
      const source = String(row.source ?? ""), day = String(row.date ?? row.day ?? "").slice(0, 10);
      if (!source || !day) continue;
      for (const m of METRICS) if (row[m] != null) out.push({ externalId: source, day, metric: m, value: Number(row[m]) || 0 });
    }
    return out;
  },
};
