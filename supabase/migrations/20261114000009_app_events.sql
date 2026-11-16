-- Application event log: errors, warnings and notable events, written by the app itself (secrets and message text are
-- stripped before anything is stored). Read by workspace admins on Settings -> Diagnostics.
create table if not exists app_events (
  id bigint generated always as identity primary key,
  org_id uuid references organizations on delete cascade,      -- null = system-wide (e.g. a crash before the workspace is known)
  level text not null check (level in ('info','warn','error')),
  source text not null,
  message text not null,
  details jsonb,
  digest text,                                                  -- Next.js error reference shown on the "Application error" page
  created_at timestamptz not null default now()
);
create index if not exists app_events_org_time on app_events (org_id, created_at desc);
create index if not exists app_events_level_time on app_events (level, created_at desc);
alter table app_events enable row level security;
drop policy if exists "admins read own org events" on app_events;
create policy "admins read own org events" on app_events for select using (org_id is not null and is_org_admin(org_id));
-- No insert/update/delete policy: only the server (service role) writes events.

-- Lets the diagnostics page check the database setup in one call.
create or replace function public.schema_status() returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'tables_without_rls', (select coalesce(jsonb_agg(c.relname), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    'same_org_triggers', (select count(*) from pg_trigger where tgname = 'same_org_guard'),
    'read_secret_for_org', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'read_secret_for_org'),
    'store_secret', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'store_secret'),
    'linkedin_channel', exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'channel_kind' and e.enumlabel = 'linkedin')
  )
$$;
revoke all on function public.schema_status() from public, anon, authenticated;
grant execute on function public.schema_status() to service_role;
