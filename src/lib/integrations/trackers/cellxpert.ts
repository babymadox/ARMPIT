import type { TrackerAdapter } from "../types";

// TODO: implement against the cellxpert API. Return metrics exactly as the tracker reports them.
export const cellxpert: TrackerAdapter = {
  kind: "cellxpert",
  async test() { return { ok: false, error: "cellxpert adapter not implemented yet" }; },
  async listAffiliates() { return []; },
  async fetchStats() { return []; },
};
