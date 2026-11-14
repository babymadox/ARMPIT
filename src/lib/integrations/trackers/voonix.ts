import type { TrackerAdapter } from "../types";

// TODO: implement against the voonix API. Return metrics exactly as the tracker reports them.
export const voonix: TrackerAdapter = {
  kind: "voonix",
  async test() { return { ok: false, error: "voonix adapter not implemented yet" }; },
  async listAffiliates() { return []; },
  async fetchStats() { return []; },
};
