import type { TrackerAdapter } from "../types";

// TODO: implement against the affilka API. Return metrics exactly as the tracker reports them.
export const affilka: TrackerAdapter = {
  kind: "affilka",
  async test() { return { ok: false, error: "affilka adapter not implemented yet" }; },
  async listAffiliates() { return []; },
  async fetchStats() { return []; },
};
