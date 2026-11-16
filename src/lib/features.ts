/**
 * What the product does and how far each part is. This is the single place to update when something is built.
 * `needs` lists schema/env checks that must pass for the feature to actually work; `evidence` names the proof
 * (a timestamp the app records when the feature really ran) shown in diagnostics.
 */
export type FeatureStatus = "done" | "partial" | "not-built";
export type Feature = { id: string; area: string; name: string; status: FeatureStatus; note?: string; needs?: string[]; evidence?: string };

export const FEATURES: Feature[] = [
  { id: "auth", area: "Core", name: "Sign-in, workspaces, roles", status: "done", needs: ["env.service_role"] },
  { id: "invites", area: "Core", name: "Team invites", status: "partial", note: "Invites are saved; no invite email is sent" },
  { id: "partners", area: "Partners", name: "Partners list, pipeline, detail, notes", status: "done" },
  { id: "singular.connect", area: "Singular", name: "Connect Singular (key check, Vault)", status: "done", needs: ["schema.vault"] },
  { id: "singular.sync", area: "Singular", name: "Sync stats (14 metrics per source/agency pair)", status: "done", needs: ["schema.sources"], evidence: "singular.sync" },
  { id: "singular.structure", area: "Singular", name: "Import/map agencies and sources", status: "done", needs: ["schema.sources", "schema.pairs"], evidence: "structure.links" },
  { id: "columns", area: "Singular", name: "Partner page column picker", status: "done", evidence: "stats.rows" },
  { id: "deals", area: "Deals & payments", name: "Deals list and status flow", status: "partial", note: "No 'new deal' form" },
  { id: "payments", area: "Deals & payments", name: "Payments list and status flow", status: "partial", note: "No adjustments or decision forms" },
  { id: "tasks", area: "Core", name: "Tasks on Overview", status: "done" },
  { id: "automations", area: "Automations", name: "Automations (silent-partner trigger only)", status: "partial", note: "Other triggers are not built", evidence: "automations.run" },
  { id: "telegram.in", area: "Inbox", name: "Telegram: receive messages", status: "done", needs: ["schema.delivery"], evidence: "telegram.inbound" },
  { id: "telegram.out", area: "Inbox", name: "Telegram: send replies", status: "done", needs: ["schema.delivery", "schema.secrets"], evidence: "reply.delivered" },
  { id: "inbox.live", area: "Inbox", name: "Inbox live refresh", status: "done" },
  { id: "chan.whatsapp", area: "Inbox", name: "WhatsApp", status: "not-built" },
  { id: "chan.teams", area: "Inbox", name: "Microsoft Teams", status: "not-built" },
  { id: "chan.gmail", area: "Inbox", name: "Gmail", status: "not-built" },
  { id: "chan.linkedin", area: "Inbox", name: "LinkedIn", status: "not-built", note: "LinkedIn messaging is restricted to approved partners" },
  { id: "trk.others", area: "Trackers", name: "Cellxpert, Affise, Affilka, Voonix, AppsFlyer", status: "not-built" },
  { id: "agent", area: "AI", name: "AI agent", status: "partial", note: "API route only, no panel in the UI", needs: ["env.anthropic"] },
  { id: "billing", area: "Core", name: "Billing (Stripe)", status: "not-built" },
  { id: "audit", area: "Core", name: "Audit log writes", status: "not-built" },
  { id: "notifications", area: "Core", name: "Notifications panel", status: "not-built" },
  { id: "diagnostics", area: "Core", name: "Diagnostics and event log", status: "done", needs: ["schema.events"], evidence: "events.recent" },
];
