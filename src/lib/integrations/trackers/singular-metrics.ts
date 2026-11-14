/**
 * Singular metrics that returned data on a live account (probed 2026-11-14, per source/agency pair, 30 days).
 * Order = default column order. `kind` drives formatting. Metrics that FAILED on that account (revenue,
 * unified_revenue, rejected/suspicious installs, est_fraud_saved_cost, event metrics) are intentionally absent:
 * one unsupported metric fails the whole report.
 */
export type MetricKind = "count" | "money";
export type MetricDef = { key: string; label: string; group: "Installs" | "Clicks" | "Network-reported"; kind: MetricKind; hint?: string };

export const SINGULAR_METRICS: MetricDef[] = [
  { key: "custom_installs", label: "Installs", group: "Installs", kind: "count" },
  { key: "tracker_installs", label: "Tracker installs", group: "Installs", kind: "count" },
  { key: "unified_installs", label: "Unified installs", group: "Installs", kind: "count" },
  { key: "mta_installs", label: "MTA installs", group: "Installs", kind: "count", hint: "Multi-touch attributed installs" },
  { key: "single_attributed_installs", label: "Single-attributed installs", group: "Installs", kind: "count" },
  { key: "co_attributed_installs", label: "Co-attributed installs", group: "Installs", kind: "count" },
  { key: "assisted_installs", label: "Assisted installs", group: "Installs", kind: "count" },
  { key: "tracker_reengagements", label: "Re-engagements", group: "Installs", kind: "count" },
  { key: "custom_clicks", label: "Clicks", group: "Clicks", kind: "count" },
  { key: "tracker_clicks", label: "Tracker clicks", group: "Clicks", kind: "count" },
  { key: "adn_impressions", label: "Impressions", group: "Network-reported", kind: "count", hint: "Only for sources with an ad-network integration" },
  { key: "adn_clicks", label: "Network clicks", group: "Network-reported", kind: "count", hint: "Only for sources with an ad-network integration" },
  { key: "adn_installs", label: "Network installs", group: "Network-reported", kind: "count", hint: "Only for sources with an ad-network integration" },
  { key: "adn_cost", label: "Cost", group: "Network-reported", kind: "money", hint: "Only for sources with an ad-network integration" },
];

/** Ratios are computed from totals, never stored or summed: summing rates across rows is wrong. */
export type DerivedDef = { key: string; label: string; group: string; num: string; den: string; kind: "percent" | "money"; hint?: string };
export const SINGULAR_DERIVED: DerivedDef[] = [
  { key: "d_install_rate", label: "Install rate", group: "Derived", num: "custom_installs", den: "custom_clicks", kind: "percent", hint: "Installs ÷ clicks" },
  { key: "d_cost_per_install", label: "Cost per install", group: "Derived", num: "adn_cost", den: "adn_installs", kind: "money", hint: "Network cost ÷ network installs" },
];

export const DEFAULT_COLUMNS = ["custom_installs", "custom_clicks", "d_install_rate", "tracker_reengagements", "adn_cost"];
