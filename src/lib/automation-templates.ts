export type Template = "silent_partner" | "no_reply" | "cap_reached" | "volume_drop";
/** The automation row a template creates. `threshold` is days for the chat triggers and a percentage for cap/drop. */
export function fromTemplate(t: Template, threshold?: number | null) {
  const n = (v: number | null | undefined, d: number) => (v != null && Number.isFinite(v) && v > 0 ? v : d);
  switch (t) {
    case "silent_partner": return { name: "Silent partner", trigger: { type: "no_message", days: n(threshold, 3) }, actions: [{ type: "create_task" }, { type: "notify", who: "owner" }] };
    case "no_reply": return { name: "No reply", trigger: { type: "no_reply", days: n(threshold, 2) }, actions: [{ type: "notify", who: "owner" }] };
    case "cap_reached": return { name: "Cap almost reached", trigger: { type: "cap_pct", pct: Math.min(100, n(threshold, 90)) }, actions: [{ type: "notify", who: "owner" }] };
    case "volume_drop": return { name: "Volume drop", trigger: { type: "metric_drop", metric: "custom_installs", pct: Math.min(100, n(threshold, 30)), days: 7, min_prev: 20 }, actions: [{ type: "notify", who: "owner" }] };
  }
}
