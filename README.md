# ARMPIT

Production skeleton of the ARMPIT demo: a workspace for affiliate managers (unified inbox, partners and tracker stats, deals, payment reconciliation, tasks, automations, team).

**Stack:** Next.js 15 (App Router, server components + server actions) · Supabase (Postgres, Auth, Realtime, Vault) · TypeScript.

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
| Tracker integrations | **Stubs** in `src/lib/integrations/trackers/*` (Cellxpert, Affise, Affilka, Voonix, AppsFlyer) |
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

1. Tracker adapter #1 (the one your first customers use) + connect flow in Settings → Integrations.
2. Telegram or Gmail end to end: connect, webhook in, outbound send worker, realtime in the inbox.
3. Invite emails, audit-log writes, notifications bell.
4. Remaining automation triggers, deal/payment forms, Stripe billing.
5. Hardening: rate limits, Sentry, backups, tests (RLS tests first), CI, staging project.
