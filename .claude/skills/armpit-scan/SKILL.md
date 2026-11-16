---
name: armpit-scan
description: Scan the whole ARMPIT project (Next.js + Supabase affiliate workspace) for correctness, security and drift. Use when asked to review, audit, scan, health-check or "understand the whole project", before a release, or after large changes.
---

# ARMPIT project scan

Run in this order. Report findings as **Confirmed** (you saw it fail or read the code) vs **Suspected** (heuristic hit). Never call something verified that you only read.

## 0. Read the app's own diagnostics first
The deployed app records what works and what fails. Before reading code, get the report:
- Ask the user to open **Settings → Diagnostics → Copy report** and paste it, or
- fetch it directly: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<site>/api/diagnostics?format=md"`
  (needs the site host allowed in the cloud environment's network settings and the secret saved with `request_credential`; never ask for it in chat).
It lists failing environment/database/integration checks, each feature as working / built-unproven / blocked / partial / not-built, when things were last proven working, and recent errors with their digest (the reference on the "Application error" page). Trust it over memory; treat anything it marks `built-unproven` as unverified.

## 1. Run the automated pass
```bash
bash .claude/skills/armpit-scan/scripts/scan.sh          # full: typecheck, tests, build, heuristics
bash .claude/skills/armpit-scan/scripts/scan.sh --quick  # heuristics only
```
It prints PASS / WARN / FAIL per check. Treat every WARN as a lead to read, not a verdict.

## 2. Map of the project
- `supabase/migrations/*.sql` — schema, RLS, Vault helpers, tracker sources, agency/source pairs, message delivery. Order matters; numbers must be gap-free.
- `src/lib/session.ts` — `requireSession()`: the only way pages/actions learn the user, org and role.
- `src/lib/supabase/{server,browser,admin}.ts` — user client (RLS applies), browser client, **service-role client (bypasses RLS)**.
- `src/lib/integrations/` — adapter contracts (`types.ts`); `trackers/` (Singular live, others stubs); `channels/` (Telegram live, others stubs).
- `src/lib/{sync,inbox,structure,columns,secrets,site,suggest}.ts` — sync engine, message ingest, agency↔source import planner, column catalogue, Vault wrapper.
- `src/app/(app)/*` — screens (server components + server actions). `src/app/api/*` — webhooks, cron, agent.
- `tests/*.test.ts` — run with `npm test` (node's built-in runner, `.ts` import extensions are required).

## 3. Invariants to verify by reading code (the scan script only hints at these)
1. **Tenant isolation:** every table has `org_id` and RLS. Service-role queries (`supabaseAdmin`) must filter by `org_id` or by an id that was first read through the user's RLS client.
2. **Every server action** starts with `requireSession()` (or a `guard()` that calls it) and checks `isAdmin` for admin-only work.
3. **Secrets** live in Supabase Vault (`storeCreds`/`readCreds`); no tokens in table columns, env files in git, logs or error messages. Webhooks verify a per-connection secret with a constant-time compare.
4. **Tracker numbers are per tracker, as reported.** Never sum across trackers; ratios are computed from totals (`columns.ts`).
5. **Singular:** a (source, agency) pair carries its own stats; unsupported metrics fail the whole report, so only metrics in `singular-metrics.ts` are requested.
6. **Webhook ingest is idempotent** and never overwrites a chat's owner or linked partner.
7. **Writes check their result.** A failed insert/update/delete must surface as an error, never as a success message. Deliberate fire-and-forget writes carry a `best effort` comment (the scan enforces this).
8. **Workspace scoping in code:** `syncConnection(scope, ...)` takes `{ orgId }` or `"all-orgs"` (cron only); `readCreds(secretId, orgId)` only returns secrets stored under that workspace. The DB trigger `enforce_same_org` blocks rows that point at another workspace's partner/member/connection.
9. **Provider calls have timeouts** and map timeouts to readable messages; page loads must not wait on a slow provider.
10. **Row cap:** Supabase returns at most 1000 rows per request and says nothing. Anything that needs all rows uses `fetchAll()` (src/lib/db.ts) or an SQL aggregate (`link_metric_totals`, `partner_metric_sums`); never `.limit(5000)`.
11. **Privacy:** notifications are private to their recipient (RLS); the audit log is admin-only; both are written by the server only (`notify`, `audit`).
12. **Logging:** notable events go through `logEvent` (never `console.log` of user data). `scrub`/`buildEventRow` strip tokens, keys and message text; keep it that way. Update `src/lib/features.ts` whenever a feature is built or its status changes: diagnostics reads it.
13. **Deletes that cascade** (unlinking an agency deletes its stats) must say so in the UI.

## 4. Verification discipline
- Run `npx tsc --noEmit`, `npm test`, and `NEXT_PUBLIC_SUPABASE_URL=http://x NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next build` after `rm -rf .next` (stale `.next` types cause false failures).
- To test SQL, apply all migrations to a throwaway local Postgres with stubbed `auth` schema; do not touch the hosted project.
- Anything needing live providers (Singular, Telegram) is **unverified** unless you actually called them; say so.

## 5. Known gaps (update this list when they change)
Duplicate guards (two Telegram connections / double import can create duplicates), Stripe billing, WhatsApp/Teams/Gmail/LinkedIn adapters, other tracker adapters (all need accounts or credentials), per-account Singular metric detection, pagination on large source lists.

## 6. Report format
Group by severity (Security, Correctness, Drift/maintainability). For each: file:line, what is wrong, evidence, suggested fix. End with what you did **not** check.
