-- Migrations 5 to 8 in order, for pasting into the Supabase SQL editor in ONE run.
-- Only run this if none of them has been applied yet (they are not all idempotent).

-- ===== 20261114000005_tracker_sources.sql =====
-- Sources discovered inside a tracker connection (for Singular: the `source` dimension), whether or not
-- they are linked to a partner yet. Linking creates a partner_links row; this table is the catalogue.
create table tracker_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  connection_id uuid not null references tracker_connections on delete cascade,
  external_id text not null,
  name text not null,
  last_seen_at timestamptz not null default now(),
  unique (connection_id, external_id)
);
create index on tracker_sources (org_id, connection_id);

alter table tracker_sources enable row level security;
create policy "org read" on tracker_sources for select using (org_id in (select my_orgs()));
-- Writes happen server-side with the service role only (discovery runs in sync jobs and admin actions).

-- ===== 20261114000006_agency_source_pairs.sql =====
-- Singular models agencies and sources as many-to-many. A (source, agency) pair is the unit that carries stats,
-- so a source can work with several agencies and an agency with several sources, each with its own numbers.
alter type channel_kind add value if not exists 'linkedin';

alter table tracker_sources add column if not exists external_group text not null default '';
alter table tracker_sources drop constraint if exists tracker_sources_connection_id_external_id_key;
alter table tracker_sources add constraint tracker_sources_pair_key unique (connection_id, external_id, external_group);

alter table partner_links add column if not exists external_group text not null default '';
alter table partner_links drop constraint if exists partner_links_connection_id_external_id_key;
alter table partner_links add constraint partner_links_pair_key unique (connection_id, external_id, external_group);

-- Catalogue rows from before agencies were tracked have no agency; they are rediscovered by the next sync.
delete from tracker_sources where external_group = '';

-- ===== 20261114000007_message_delivery.sql =====
-- Outbound messages are saved first, then delivered by the channel adapter; record how that went.
alter table messages add column if not exists delivery_status text not null default 'sent' check (delivery_status in ('pending','sent','failed'));
alter table messages add column if not exists error text;

-- ===== 20261114000008_workspace_guards.sql =====
-- 1) A row may only reference rows of its own workspace (partner, owner, assignee, connection...).
--    RLS checks the row's own org_id but not what its foreign keys point at; this closes that gap for every writer.
create or replace function public.enforce_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare spec text; col text; ref text; v uuid; ref_org uuid;
begin
  foreach spec in array tg_argv loop
    col := split_part(spec, ':', 1); ref := split_part(spec, ':', 2);
    execute format('select ($1).%I', col) into v using new;
    if v is not null then
      execute format('select org_id from public.%I where id = $1', ref) into ref_org using v;
      if ref_org is distinct from new.org_id then
        raise exception 'cross-workspace reference: %.% -> %', tg_table_name, col, ref using errcode = '23514';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.enforce_same_org() from public, anon, authenticated;

do $$
declare t record;
begin
  for t in select * from (values
    ('conversations',       array['partner_id:partners','owner_id:members','connection_id:channel_connections']),
    ('tasks',               array['partner_id:partners','assignee_id:members']),
    ('deals',               array['partner_id:partners','owner_id:members','requested_by:members']),
    ('payments',            array['partner_id:partners','deal_id:deals','owner_id:members']),
    ('payment_adjustments', array['payment_id:payments','created_by:members']),
    ('partners',            array['owner_id:members','status_id:partner_statuses']),
    ('partner_links',       array['partner_id:partners','connection_id:tracker_connections']),
    ('partner_notes',       array['partner_id:partners','author_id:members']),
    ('channel_connections', array['member_id:members']),
    ('notifications',       array['member_id:members']),
    ('members',             array['lead_id:members']),
    ('audit_log',           array['actor_id:members'])
  ) as v(tbl, cols) loop
    execute format('drop trigger if exists same_org_guard on public.%I', t.tbl);
    execute format('create trigger same_org_guard before insert or update on public.%I for each row execute function public.enforce_same_org(%s)',
                   t.tbl, (select string_agg(quote_literal(c), ',') from unnest(t.cols) c));
  end loop;
end $$;
-- High-volume tables (tracker_stats, tracker_sources, messages) are written only by server code that derives org_id from the parent row.

-- 2) Credentials can only be read for the workspace that stored them (secret names start with "<org_id>:").
create or replace function public.read_secret_for_org(secret_id uuid, org uuid) returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = secret_id and name like org::text || ':%'
$$;
revoke all on function public.read_secret_for_org(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_secret_for_org(uuid, uuid) to service_role;
