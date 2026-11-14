# ARMPIT

Production skeleton of the ARMPIT demo: a workspace for affiliate managers (unified inbox, partners and tracker stats, deals, payment reconciliation, tasks, automations, team).

**Stack:** Next.js 15 (App Router, server components + server actions) · Supabase (Postgres, Auth, Realtime, Vault) · TypeScript.

## Hosted Supabase

Project `armpit` (ref `nhnwzxttpncechcgqqvl`, ap-south-1) has migrations 1 to 4 applied. **Migrations 5 and 6 may not be applied yet** (`tracker_sources`, agency/source pairs, LinkedIn channel). Run `npx supabase db push` or paste `supabase/migrations/20261114000005_tracker_sources.sql` into the SQL editor. `.env.example` points at it; add the service-role key yourself.

## Run it locally

```bash
cp .env.example .env.local      # fill NEXT_PUBLIC_SUPABASE_ANON_KEY from `supabase status`
npm install
npx supabase start              # applies supabase/migrations
npm run dev                     # http://localhost:3000
```

Sign up at `/login`, create your workspace at `/onboarding`, then load sample data:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed.sql
```

## What is real vs. stubbed

| Area | State |
|---|---|
| Auth, orgs, roles (owner/admin/member), invites, seat limit | Working. Invite **email** is not sent yet. |
| Tenant isolation | Working. Every table has RLS; inbox chats are visible to the owner and admins only. |
| Partners (list, pipeline board, detail, notes timeline) | Working |
| Deals (create via seed, status flow, admin-only approval) | Working; no "new deal" form yet |
| Payments (expected vs tracker gap, status flow) | Working; adjustments/decision modals not built |
| Tasks (Overview) | Working |
| Automations | Admin CRUD works; the cron evaluates only `no_message`. Metric-drop and cap triggers are TODO. |
| Inbox | Reads, replies and realtime-ready schema. **Nothing is delivered to providers yet.** |
| Singular tracker | Implemented (`trackers/singular.ts`) with a connect form in Settings, credentials in Vault, hourly sync. Request/response shapes verified against Singular's official Python client and covered by mocked tests (`npm test`) and **run live against a real Singular account** (key check plus a 7-day sync). Requests the 14 metrics in `trackers/singular-metrics.ts` (all probed live and returning data); a partner page shows them in a column picker with derived columns (install rate, cost per install). Metrics that failed on the probed account (`revenue`, fraud and event metrics) are excluded because one unsupported metric fails the whole report. Network-reported metrics (impressions, cost) only exist for sources with an ad-network integration. |
| Agencies ↔ sources (Singular) | `/settings/integrations/[id]`. Singular models this as many-to-many: a source can work with several agencies and an agency with several sources, with separate stats per (source, agency) pair. **Import structure** creates a partner per agency and links every pair; **Map** attaches an agency to an existing partner (exact-name matching only); views by agency and by source. Needs migrations 5 and 6. |
| Inbox channels | Telegram, WhatsApp, Teams, Gmail and LinkedIn show as "API setup required" until their adapters are implemented. No placeholder data is shown. |
| Other trackers | **Stubs** (Cellxpert, Affise, Affilka, Voonix, AppsFlyer) |
| Channel integrations | **Stubs** in `src/lib/integrations/channels/*` (Telegram, WhatsApp, Teams, Gmail) |
| AI agent | `POST /api/agent` answers from RLS-scoped data; no UI panel yet |
| Billing (Stripe), notifications UI, audit-log writes, onboarding wizard | TODO |

## Layout

- `supabase/migrations`: schema and RLS. `seed.sql`: dev data.
- `src/lib/session.ts`: resolves the signed-in member + org; use `requireSession()` in every page and action.
- `src/lib/integrations`: adapter contracts (`types.ts`) and one file per provider.
- `src/app/api/webhooks/[channel]`: inbound messages. `src/app/api/cron/*`: scheduled jobs (`vercel.json`), guarded by `CRON_SECRET`.

## Rules worth keeping

1. Tracker metrics are stored and shown per tracker, exactly as reported. Never sum across trackers (the demo's rule).
2. The service-role client (`supabaseAdmin`) bypasses RLS. Use it only in webhooks and cron, and always filter by `org_id`.
3. Provider credentials go in Supabase Vault, referenced by `vault_secret_id`; never in table columns.

## Suggested order of work

1. Make the Singular metric list configurable per account (e.g. opt in to `revenue`).
2. Telegram or Gmail end to end: connect, webhook in, outbound send worker, realtime in the inbox.
3. Invite emails, audit-log writes, notifications bell.
4. Remaining automation triggers, deal/payment forms, Stripe billing.
5. Hardening: rate limits, Sentry, backups, tests (RLS tests first), CI, staging project.

## Deploy (Vercel)

1. Import the GitHub repo in Vercel (framework: Next.js, no build settings to change).
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
3. Supabase → Authentication → URL Configuration: set Site URL to the Vercel URL and add it to Redirect URLs.
4. `vercel.json` crons run daily so the Hobby plan accepts them; on Pro, raise the frequency (sync hourly, automations every 15 min) and `maxDuration`.
