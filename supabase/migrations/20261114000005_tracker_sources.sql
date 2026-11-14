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
