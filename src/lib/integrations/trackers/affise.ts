import type { TrackerAdapter } from "../types";

// TODO: implement against the affise API. Return metrics exactly as the tracker reports them.
export const affise: TrackerAdapter = {
  kind: "affise",
  async test() { return { ok: false, error: "affise adapter not implemented yet" }; },
  async listAffiliates() { return []; },
  async fetchStats() { return []; },
};
