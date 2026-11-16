import { supabaseAdmin } from "./supabase/admin";
import { channels } from "./integrations";
import { readCreds } from "./secrets";
import { webhookUrl } from "./site";
import { errMsg } from "./scrub.ts";
import { logEvent } from "./log";
import type { Check, Evidence, EventRow, Report } from "./report.ts";

type Opts = { origin: string; includeSystem: boolean };
const MIGRATION = (n: number, file: string) => `Run migration ${n} (supabase/migrations/${file}) in the Supabase SQL editor`;

/** Builds the diagnostics report for one workspace. Every probe is independent: one failing never hides the rest. */
export async function buildReport(orgId: string, { origin, includeSystem }: Opts): Promise<Report> {
  const db = supabaseAdmin();
  await logEvent({ orgId, level: "info", source: "diagnostics", message: "report generated" });   // write now, read back below: proves the event log round trip
  const checks: Check[] = [], evidence: Evidence[] = [], counts: Record<string, number | null> = {};
  const probe = async (id: string, label: string, fix: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const { error } = await run(); checks.push({ id, group: "Database", label, status: error ? "fail" : "ok", detail: error?.message, fix: error ? fix : undefined }); }
    catch (e) { checks.push({ id, group: "Database", label, status: "unknown", detail: errMsg(e) }); }
  };

  // ---- environment (presence only, never values)
  const env = (id: string, label: string, name: string, fix: string, optional = false) => {
    const set = !!process.env[name];
    checks.push({ id, group: "Environment", label, status: set ? "ok" : optional ? "unknown" : "fail", detail: set ? "set" : optional ? "not set (optional)" : "not set", fix: set || optional ? undefined : fix });
  };
  env("env.url", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "Set NEXT_PUBLIC_SUPABASE_URL in Vercel and redeploy");
  env("env.anon", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "Set NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel and redeploy");
  env("env.service_role", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "Set SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy");
  env("env.cron", "CRON_SECRET", "CRON_SECRET", "Set CRON_SECRET in Vercel (any long random string) and redeploy; scheduled syncs and this report's token endpoint need it");
  env("env.anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "", true);

  // ---- database: probe the objects each migration adds
  await Promise.all([
    probe("schema.sources", "tracker_sources table (migration 5)", MIGRATION(5, "20261114000005_tracker_sources.sql"), () => db.from("tracker_sources").select("id").limit(0)),
    probe("schema.pairs", "Agency/source pair columns (migration 6)", MIGRATION(6, "20261114000006_agency_source_pairs.sql"), () => db.from("partner_links").select("external_group").limit(0)),
    probe("schema.delivery", "Message delivery columns (migration 7)", MIGRATION(7, "20261114000007_message_delivery.sql"), () => db.from("messages").select("delivery_status,error").limit(0)),
    probe("schema.events", "app_events table (migration 9)", MIGRATION(9, "20261114000009_app_events.sql"), () => db.from("app_events").select("id").limit(0)),
  ]);
  await Promise.all([
    probe("schema.workflow.conv", "Chat recency columns (migration 10)", MIGRATION(10, "20261114000010_workflow_features.sql"), () => db.from("conversations").select("last_direction,last_inbound_at").limit(0)),
    probe("schema.workflow.pay", "Payment decision columns (migration 10)", MIGRATION(10, "20261114000010_workflow_features.sql"), () => db.from("payments").select("agreed_amount,decided_at").limit(0)),
    probe("schema.workflow.notif", "Notification dedupe column (migration 10)", MIGRATION(10, "20261114000010_workflow_features.sql"), () => db.from("notifications").select("dedupe_key").limit(0)),
  ]);
  await Promise.all([
    probe("schema.email.conn", "Mailbox columns (migration 11)", MIGRATION(11, "20261114000011_email_channel.sql"), () => db.from("channel_connections").select("sync_state,last_polled_at,last_error").limit(0)),
    probe("schema.email.subject", "Message subject column (migration 11)", MIGRATION(11, "20261114000011_email_channel.sql"), () => db.from("messages").select("subject").limit(0)),
  ]);
  await probe("schema.activation", "activation_codes table (migration 12)", MIGRATION(12, "20261114000012_activation_codes.sql"), () => db.from("activation_codes").select("id").limit(0));
  try {
    const { error } = await db.rpc("read_secret_for_org", { secret_id: crypto.randomUUID(), org: orgId });
    const missing = !!error && (error as { code?: string }).code === "PGRST202";
    checks.push({ id: "schema.secrets", group: "Database", label: "Workspace-scoped credential reads (migration 8)", status: missing ? "fail" : "ok", detail: missing ? "function read_secret_for_org not found" : undefined, fix: missing ? MIGRATION(8, "20261114000008_workspace_guards.sql") : undefined });
  } catch (e) { checks.push({ id: "schema.secrets", group: "Database", label: "Workspace-scoped credential reads (migration 8)", status: "unknown", detail: errMsg(e) }); }
  const ss = await db.rpc("schema_status");
  const st = ss.error ? null : (ss.data as { tables_without_rls: string[]; same_org_triggers: number; store_secret: boolean; linkedin_channel: boolean });
  const need9 = "needs migration 9 to verify";
  checks.push({ id: "schema.vault", group: "Database", label: "Vault helper functions (migration 3)", status: st ? (st.store_secret ? "ok" : "fail") : "unknown", detail: st ? undefined : need9, fix: st && !st.store_secret ? MIGRATION(3, "20261114000003_vault.sql") : undefined });
  checks.push({ id: "schema.guards", group: "Database", label: "Cross-workspace guards (migration 8)", status: st ? (st.same_org_triggers >= 12 ? "ok" : "fail") : "unknown", detail: st ? `${st.same_org_triggers} triggers` : need9, fix: st && st.same_org_triggers < 12 ? MIGRATION(8, "20261114000008_workspace_guards.sql") : undefined });
  checks.push({ id: "schema.rls", group: "Database", label: "Row level security on every table", status: st ? (st.tables_without_rls.length ? "fail" : "ok") : "unknown", detail: st ? (st.tables_without_rls.length ? `missing on: ${st.tables_without_rls.join(", ")}` : undefined) : need9, fix: st?.tables_without_rls.length ? "Enable row level security on the listed tables" : undefined });
  checks.push({ id: "schema.linkedin", group: "Database", label: "LinkedIn channel value (migration 6)", status: st ? (st.linkedin_channel ? "ok" : "fail") : "unknown", detail: st ? undefined : need9, fix: st && !st.linkedin_channel ? MIGRATION(6, "20261114000006_agency_source_pairs.sql") : undefined });

  // ---- integrations
  const safe = async <T,>(f: () => PromiseLike<T>, d: T): Promise<T> => { try { return await f(); } catch { return d; } };
  const trk = await safe(async () => (await db.from("tracker_connections").select("id,kind,status,last_synced_at").eq("org_id", orgId)).data ?? [], [] as any[]);
  const sing = trk.find((t: any) => t.kind === "singular");
  checks.push({ id: "int.singular", group: "Integrations", label: "Singular connection", status: !sing ? "unknown" : sing.status === "error" ? "fail" : "ok",
    detail: !sing ? "not connected" : `status ${sing.status}, last synced ${sing.last_synced_at ?? "never"}`, fix: sing?.status === "error" ? "Open Settings → Singular → Sync last 30 days and read the error; check the API key and that api.singular.net is reachable" : undefined });
  const tg = await safe(async () => (await db.from("channel_connections").select("id,external_account,status,vault_secret_id").eq("org_id", orgId).eq("kind", "telegram").limit(1)).data?.[0] ?? null, null as any);
  if (!tg) checks.push({ id: "int.telegram", group: "Integrations", label: "Telegram connection", status: "unknown", detail: "not connected" });
  else {
    try {
      const s = await channels.telegram.status(await readCreds(tg.vault_secret_id, orgId), webhookUrl(origin, "telegram", tg.id));
      checks.push({ id: "int.telegram", group: "Integrations", label: `Telegram ${tg.external_account ?? ""}`.trim(), status: s.ok ? "ok" : "fail", detail: s.detail, fix: s.ok ? undefined : "Settings → Channels: disconnect and reconnect Telegram from the address you actually use" });
    } catch (e) { checks.push({ id: "int.telegram", group: "Integrations", label: "Telegram connection", status: "fail", detail: errMsg(e), fix: "Settings → Channels: reconnect Telegram" }); }
  }

  // ---- data counts and proof that things have actually run
  const count = async (k: string, table: string, f?: (q: any) => any) => { try { let q: any = db.from(table).select("*", { count: "exact", head: true }).eq("org_id", orgId); if (f) q = f(q); const { count: n, error } = await q; counts[k] = error ? null : n ?? 0; } catch { counts[k] = null; } };
  await Promise.all([count("partners", "partners"), count("partner_links (source↔agency pairs)", "partner_links"), count("tracker_stats rows", "tracker_stats"), count("conversations", "conversations"),
    count("messages", "messages"), count("members", "members"), count("automations", "automations")]);
  const latest = async (id: string, label: string, run: () => PromiseLike<{ data: any; error: any }>, pick: (row: any) => string | null | undefined, detail?: string) => {
    try { const { data, error } = await run(); const row = Array.isArray(data) ? data[0] : data; evidence.push({ id, label, at: error ? null : pick(row) ?? null, detail: error ? `query failed: ${error.message}` : detail }); }
    catch (e) { evidence.push({ id, label, at: null, detail: errMsg(e) }); }
  };
  await Promise.all([
    latest("singular.sync", "Singular sync completed", () => db.from("tracker_connections").select("last_synced_at").eq("org_id", orgId).eq("kind", "singular").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1), (r) => r?.last_synced_at),
    latest("stats.rows", "Stats stored for a partner (latest day)", () => db.from("tracker_stats").select("day").eq("org_id", orgId).order("day", { ascending: false }).limit(1), (r) => (r?.day ? `${r.day}T00:00:00Z` : null), counts["tracker_stats rows"] != null ? `${counts["tracker_stats rows"]} rows` : undefined),
    latest("structure.links", "Agencies/sources linked to partners", () => db.from("tracker_connections").select("last_synced_at").eq("org_id", orgId).eq("kind", "singular").limit(1), (r) => ((counts["partner_links (source↔agency pairs)"] ?? 0) > 0 ? r?.last_synced_at ?? "yes" : null), `${counts["partner_links (source↔agency pairs)"] ?? "?"} links`),
    latest("telegram.inbound", "Telegram message received", () => db.from("messages").select("sent_at, conversation:conversations!inner(channel)").eq("org_id", orgId).eq("direction", "in").eq("conversation.channel", "telegram").order("sent_at", { ascending: false }).limit(1), (r) => r?.sent_at),
    latest("reply.delivered", "Reply delivered to a channel", () => db.from("messages").select("sent_at").eq("org_id", orgId).eq("direction", "out").eq("delivery_status", "sent").not("external_id", "is", null).order("sent_at", { ascending: false }).limit(1), (r) => r?.sent_at),
    latest("automations.run", "An automation ran", () => db.from("automations").select("last_run_at").eq("org_id", orgId).not("last_run_at", "is", null).order("last_run_at", { ascending: false }).limit(1), (r) => r?.last_run_at),
    latest("cron.sync", "Scheduled sync ran", () => db.from("app_events").select("created_at").like("source", "cron.sync%").order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("auth.members", "A member joined the workspace", () => db.from("members").select("created_at").eq("org_id", orgId).eq("status", "active").order("created_at", { ascending: false }).limit(1), (r) => r?.created_at, counts["members"] != null ? `${counts["members"]} members` : undefined),
    latest("partners.exist", "A partner exists", () => db.from("partners").select("created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1), (r) => r?.created_at, counts["partners"] != null ? `${counts["partners"]} partners` : undefined),
    latest("tasks.exist", "A task was created", () => db.from("tasks").select("created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("singular.connected", "Singular was connected", () => db.from("tracker_connections").select("created_at").eq("org_id", orgId).eq("kind", "singular").order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("invites.sent", "An invite link was created", () => db.from("app_events").select("created_at").eq("org_id", orgId).eq("source", "team.invite").eq("level", "info").like("message", "invite link created%").order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("deals.created", "A deal was created in the app", () => db.from("deals").select("created_at").eq("org_id", orgId).not("requested_by", "is", null).order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("payments.decided", "A payment decision was recorded", () => db.from("payments").select("decided_at").eq("org_id", orgId).not("decided_at", "is", null).order("decided_at", { ascending: false }).limit(1), (r) => r?.decided_at),
    latest("audit.written", "An audit entry was written", () => db.from("audit_log").select("created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("notifications.created", "A notification was created", () => db.from("notifications").select("created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("agent.answered", "The AI agent answered a question", () => db.from("app_events").select("created_at").eq("org_id", orgId).eq("source", "agent").eq("message", "answered").order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("email.received", "Email received from a partner", () => db.from("messages").select("sent_at, conversation:conversations!inner(channel)").eq("org_id", orgId).eq("direction", "in").eq("conversation.channel", "email").order("sent_at", { ascending: false }).limit(1), (r) => r?.sent_at),
    latest("activation.issued", "An activation code was issued", () => db.from("app_events").select("created_at").eq("source", "admin.activation").order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
    latest("events.recent", "Event log is recording", () => db.from("app_events").select("created_at").or(`org_id.eq.${orgId},org_id.is.null`).order("created_at", { ascending: false }).limit(1), (r) => r?.created_at),
  ]);

  // ---- events: problems first, then recent activity
  const scope = (q: any) => (includeSystem ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.eq("org_id", orgId));
  const [bad, info] = await Promise.all([
    safe(async () => (await scope(db.from("app_events").select("level,source,message,digest,created_at,org_id").in("level", ["warn", "error"]).order("created_at", { ascending: false }).limit(30))).data ?? [], [] as EventRow[]),
    safe(async () => (await scope(db.from("app_events").select("level,source,message,digest,created_at,org_id").eq("level", "info").neq("source", "diagnostics").order("created_at", { ascending: false }).limit(15))).data ?? [], [] as EventRow[]),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    app: { commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null, url: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null },
    checks, evidence, counts, events: [...(bad as EventRow[]), ...(info as EventRow[])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

/** True when this deployment has exactly one workspace, so unscoped system errors are safe to show its admins. */
export async function isSingleTenant(): Promise<boolean> {
  const { count } = await supabaseAdmin().from("organizations").select("id", { count: "exact", head: true });
  return count === 1;
}
