/**
 * What the product does and how far each part is. This is the single place to update when something is built.
 * `needs` lists schema/env checks that must pass for the feature to actually work; `evidence` names the proof
 * (a timestamp the app records when the feature really ran) shown in diagnostics. A feature marked "done" must have
 * `evidence`, or `manual: true` when nothing can prove it automatically (it then shows as built-unproven).
 */
export type FeatureStatus = "done" | "partial" | "not-built";
export type Feature = { id: string; area: string; name: string; status: FeatureStatus; note?: string; needs?: string[]; evidence?: string; manual?: boolean; verifiedManually?: string };

export const FEATURES: Feature[] = [
  { id: "auth", area: "Core", name: "Sign-in, workspaces, roles", status: "done", needs: ["env.service_role"], evidence: "auth.members" },
  { id: "invites", area: "Core", name: "Team invites (link, optional email from your mailbox, resend, revoke, accept page)", status: "done", needs: ["env.service_role"], evidence: "invites.sent" },
  { id: "partners", area: "Partners", name: "Partners list, pipeline, detail, notes", status: "done", evidence: "partners.exist" },
  { id: "singular.connect", area: "Singular", name: "Connect Singular (key check, Vault)", status: "done", needs: ["schema.vault"], evidence: "singular.connected" },
  { id: "singular.sync", area: "Singular", name: "Sync stats (14 metrics per source/agency pair)", status: "done", needs: ["schema.sources"], evidence: "singular.sync" },
  { id: "singular.structure", area: "Singular", name: "Import/map agencies and sources", status: "done", needs: ["schema.sources", "schema.pairs"], evidence: "structure.links" },
  { id: "columns", area: "Singular", name: "Partner page column picker", status: "done", evidence: "stats.rows" },
  { id: "deals", area: "Deals & payments", name: "Deals: create, submit for approval, approve, start, end", status: "done", needs: ["schema.workflow"], evidence: "deals.created" },
  { id: "payments", area: "Deals & payments", name: "Payments: adjustments, invoice, decision, status flow", status: "done", needs: ["schema.workflow"], evidence: "payments.decided" },
  { id: "tasks", area: "Core", name: "Tasks on Overview", status: "done", evidence: "tasks.exist" },
  { id: "automations", area: "Automations", name: "Automations: silent partner, no reply, cap reached, volume drop", status: "done", needs: ["schema.workflow"], evidence: "automations.run" },
  { id: "telegram.in", area: "Inbox", name: "Telegram: receive messages", status: "done", needs: ["schema.delivery"], evidence: "telegram.inbound" },
  { id: "telegram.out", area: "Inbox", name: "Telegram: send replies", status: "done", needs: ["schema.delivery", "schema.secrets"], evidence: "reply.delivered" },
  { id: "inbox.live", area: "Inbox", name: "Inbox live refresh", status: "done", manual: true, verifiedManually: "2026-11-16 (confirmed by the owner)", note: "Open the inbox in two windows, send a Telegram message, and check it appears without a refresh" },
  { id: "chan.whatsapp", area: "Inbox", name: "WhatsApp", status: "not-built", note: "Needs a Meta business account and a dedicated phone number" },
  { id: "chan.teams", area: "Inbox", name: "Microsoft Teams", status: "not-built", note: "Needs an Azure app registration and tenant admin consent" },
  { id: "chan.email", area: "Inbox", name: "Email: any mailbox (Gmail, Outlook, Yahoo, company) over IMAP/SMTP", status: "done", needs: ["schema.email"], evidence: "email.received" },
  { id: "chan.linkedin", area: "Inbox", name: "LinkedIn", status: "not-built", note: "LinkedIn messaging is restricted to approved partners" },
  { id: "trk.others", area: "Trackers", name: "Cellxpert, Affise, Affilka, Voonix, AppsFlyer", status: "not-built", note: "Each needs API access and documentation for that account" },
  { id: "agent", area: "AI", name: "Ask ARMPIT (AI agent)", status: "done", needs: ["env.anthropic"], evidence: "agent.answered" },
  { id: "activation", area: "Core", name: "Activation codes: workspace creation needs a code only the operator can issue", status: "done", needs: ["schema.activation"], evidence: "activation.issued" },
  { id: "billing", area: "Core", name: "Billing (Stripe)", status: "not-built", note: "Needs a Stripe account, product and price" },
  { id: "audit", area: "Core", name: "Audit log (admins)", status: "done", needs: ["schema.workflow"], evidence: "audit.written" },
  { id: "notifications", area: "Core", name: "Notifications (bell, page, automatic alerts)", status: "done", needs: ["schema.workflow"], evidence: "notifications.created" },
  { id: "diagnostics", area: "Core", name: "Diagnostics and event log", status: "done", needs: ["schema.events"], evidence: "events.recent" },
];
