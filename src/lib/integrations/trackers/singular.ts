import type { MetricRow, TrackerAdapter } from "../types";
import { SINGULAR_METRICS } from "./singular-metrics.ts";

/**
 * Singular (MMP) via the Reporting API: create an async report, poll its status, download the rows.
 *
 * Verified against Singular's official client (github.com/singular-labs/singular_api_client, read 2026-11-14):
 *  - Base URL https://api.singular.net/api/, auth is the `Authorization: <api_key>` header.
 *  - POST v2.0/create_async_report with a form-encoded body: start_date, end_date (YYYY-mm-dd), dimensions,
 *    metrics (comma separated), format (json|csv), time_breakdown (all|day|week|month), country_code_format.
 *    Response: { value: { report_id } }.
 *  - GET v2.0/get_report_status?report_id=... Response: { value: { report_id, status, download_url,
 *    url_expires_in, error_message } } with status QUEUED | STARTED | DONE | FAILED.
 *  - Rows are `{ results: [...] }` with `source`, `agency_name`, `start_date`, `end_date` and numeric metric columns.
 *  - GET v2.0/reporting/filters is a cheap authenticated call, used here to validate a key.
 *
 * Not yet exercised against a live Singular account: run one real sync before relying on it, and confirm
 * the metrics below are enabled for that account.
 */
const BASE = "https://api.singular.net/api";
// One row per (source, agency, day): Singular models agencies and sources as many-to-many, and stats are per pair.
export const DIMENSIONS = ["source", "agency_name"];
// Stored exactly as Singular reports them. The list (and why others are excluded) lives in singular-metrics.ts.
export const METRICS = SINGULAR_METRICS.map((m) => m.key);
const POLL_MS = 3000, MAX_POLLS = 40;

type Creds = { api_key?: string };
type Opts = { fetch?: typeof fetch; pollMs?: number };

const key = (c: Creds) => { if (!c.api_key) throw new Error("Singular api_key missing"); return c.api_key; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeSingular({ fetch: f = fetch, pollMs = POLL_MS }: Opts = {}): TrackerAdapter {
  const call = async (apiKey: string, method: "GET" | "POST", path: string, form?: Record<string, string>, query?: Record<string, string>) => {
    const url = `${BASE}/${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const r = await f(url, {
      signal: AbortSignal.timeout(30_000), method, headers: { Authorization: apiKey, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
    }).catch((e) => { throw new Error((e as Error)?.name === "TimeoutError" ? "Singular did not respond in time" : "Could not reach Singular"); });
    if (!r.ok) throw new Error(`Singular ${path} returned ${r.status}`);
    return r.json() as Promise<{ value?: any }>;
  };

  async function runReport(apiKey: string, from: string, to: string): Promise<Record<string, any>[]> {
    const created = await call(apiKey, "POST", "v2.0/create_async_report", {
      start_date: from, end_date: to, dimensions: DIMENSIONS.join(","), metrics: METRICS.join(","),
      format: "json", time_breakdown: "day", country_code_format: "iso3",
    });
    const id = created.value?.report_id;
    if (!id) throw new Error("Singular: no report_id in response");

    for (let i = 0; i < MAX_POLLS; i++) {
      const s = (await call(apiKey, "GET", "v2.0/get_report_status", undefined, { report_id: String(id) })).value ?? {};
      if (s.status === "FAILED") throw new Error(`Singular report failed: ${s.error_message ?? "unknown error"}`);
      if (s.status === "DONE") {
        if (!s.download_url) throw new Error("Singular: report DONE without download_url");
        const d = await f(s.download_url, { signal: AbortSignal.timeout(45_000) }).catch((e) => { throw new Error((e as Error)?.name === "TimeoutError" ? "Singular download timed out" : "Could not download the Singular report"); });   // pre-signed URL: no Authorization header
        if (!d.ok) throw new Error(`Singular download returned ${d.status}`);
        const body: any = await d.json();
        return Array.isArray(body) ? body : body?.results ?? body?.value?.results ?? [];
      }
      await wait(pollMs);                                       // QUEUED | STARTED
    }
    throw new Error("Singular report timed out");
  }

  const stats = async (creds: Creds, from: string, to: string): Promise<MetricRow[]> => {
    const out: MetricRow[] = [];
    for (const row of await runReport(key(creds), from, to)) {
      const source = row.source == null ? "" : String(row.source), day = String(row.start_date ?? "").slice(0, 10);
      const group = row.agency_name == null ? "" : String(row.agency_name);
      if (!source || !day) continue;
      for (const m of METRICS) if (row[m] != null) out.push({ externalId: source, group, day, metric: m, value: Number(row[m]) || 0 });
    }
    return out;
  };

  return {
    kind: "singular",
    async test(creds) {
      try { await call(key(creds), "GET", "v2.0/reporting/filters"); return { ok: true }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Singular has no directory endpoint: list the distinct (source, agency) pairs seen in the last 30 days. */
    async listAffiliates(creds) {
      const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
      const rows = await stats(creds, iso(Date.now() - 30 * 864e5), iso(Date.now()));
      const seen = new Map(rows.map((r) => [`${r.externalId}|${r.group}`, { externalId: r.externalId, group: r.group, name: r.externalId }]));
      return [...seen.values()];
    },
    fetchStats: stats,
  };
}

export const singular = makeSingular();
