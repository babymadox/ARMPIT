import type { TrackerAdapter } from "../types";

// TODO: implement against the appsflyer API. Return metrics exactly as the tracker reports them.
export const appsflyer: TrackerAdapter = {
  kind: "appsflyer",
  async test() { return { ok: false, error: "appsflyer adapter not implemented yet" }; },
  async listAffiliates() { return []; },
  async fetchStats() { return []; },
};
