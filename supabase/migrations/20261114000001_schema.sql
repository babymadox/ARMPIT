-- ARMPIT core schema. Multi-tenant: every row carries org_id and is protected by RLS (see next migration).
create extension if not exists pgcrypto;

create type member_role   as enum ('owner_admin','admin','member');
create type member_status as enum ('active','invited','suspended');
create type partner_type  as enum ('publisher','advertiser');
create type tracker_kind  as enum ('cellxpert','affise','affilka','voonix','appsflyer','singular');
create type channel_kind  as enum ('telegram','whatsapp','teams','gmail');
create type deal_kind     as enum ('cpa','cpl','revshare','hybrid');
create type deal_status   as enum ('draft','pending_approval','approved','live','ended');
create type deal_dir      as enum ('out','in');           -- out = we pay a publisher, in = advertiser pays us
create type pay_status    as enum ('waiting_for_data','ready','difference','waiting_for_invoice','invoiced','waiting_for_approval','approved','disputed','overdue','paid','confirmed');
create type task_status   as enum ('open','in_progress','blocked','done');
create type task_priority as enum ('low','normal','high');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'monthly',
  seats int not null default 5,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  user_id uuid references auth.users on delete set null,   -- null while invited
  email text not null,
  full_name text,
  role member_role not null default 'member',
  status member_status not null default 'invited',
  lead_id uuid references members on delete set null,       -- team lead
  team_name text,
  color text default '#7c3aed',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, email),
  unique (org_id, user_id)
);
create index on members (user_id);

create table partner_statuses (            -- editable org-wide pipeline columns
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null, color text not null default '#94a3b8', position int not null default 0
);

create table partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null,
  type partner_type not null default 'publisher',
  vertical text, contact_name text, email text,
  owner_id uuid references members on delete set null,
  status_id uuid references partner_statuses on delete set null,
  traffic_sources text[] not null default '{}',
  geos text[] not null default '{}',
  joined_at date, created_at timestamptz not null default now()
);
create index on partners (org_id, owner_id);

create table tracker_connections (         -- one per connected tracker account; secrets live in Supabase Vault
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  kind tracker_kind not null,
  label text, currency text not null default 'USD',
  vault_secret_id uuid,                    -- vault.secrets.id holding API credentials
  status text not null default 'connected', last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table partner_links (               -- a partner's affiliate id inside a tracker
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  partner_id uuid not null references partners on delete cascade,
  connection_id uuid not null references tracker_connections on delete cascade,
  external_id text not null,
  unique (connection_id, external_id)
);

-- Tracker metrics are stored exactly as each tracker reports them. Never summed across trackers.
create table tracker_stats (
  link_id uuid not null references partner_links on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  day date not null, metric text not null, value numeric not null default 0,
  primary key (link_id, day, metric)
);
create index on tracker_stats (org_id, day);

create table deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  partner_id uuid not null references partners on delete cascade,
  direction deal_dir not null default 'out',
  brand text, kind deal_kind not null default 'cpa',
  amount numeric, rev_share_pct numeric, cap int, progress int default 0,
  currency text default 'USD', metric text,
  geos text[] not null default '{}', traffic_sources text[] not null default '{}',
  promo_code text, landing_url text,
  status deal_status not null default 'draft',
  owner_id uuid references members on delete set null,
  requested_by uuid references members on delete set null,
  starts_on date, ends_on date, files text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on deals (org_id, partner_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  partner_id uuid not null references partners on delete cascade,
  deal_id uuid references deals on delete set null,
  direction deal_dir not null default 'out',
  period date not null,                       -- first day of the billed month
  currency text not null default 'USD',
  expected numeric not null default 0,        -- what the deal terms say
  tracker_amount numeric,                     -- what the tracker statement says
  invoiced_amount numeric, invoice_number text,
  status pay_status not null default 'waiting_for_data',
  blocker text, calc text,
  owner_id uuid references members on delete set null,
  due_on date, files text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on payments (org_id, period, status);

create table payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  payment_id uuid not null references payments on delete cascade,
  amount numeric not null, reason text not null,
  created_by uuid references members, created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  partner_id uuid references partners on delete set null,
  title text not null, category text,
  assignee_id uuid references members on delete set null,
  status task_status not null default 'open',
  priority task_priority not null default 'normal',
  due_on date, created_at timestamptz not null default now()
);
create index on tasks (org_id, assignee_id, status);

create table channel_connections (          -- a team member's connected messaging account
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  member_id uuid not null references members on delete cascade,
  kind channel_kind not null,
  external_account text, vault_secret_id uuid,
  status text not null default 'connected', created_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  channel channel_kind not null,
  connection_id uuid references channel_connections on delete set null,
  external_id text not null,                 -- chat id / thread id at the provider
  title text, is_group boolean not null default false,
  partner_id uuid references partners on delete set null,
  owner_id uuid references members on delete set null,
  unread boolean not null default false, muted boolean not null default false,
  last_message_at timestamptz, created_at timestamptz not null default now(),
  unique (org_id, channel, external_id)
);
create index on conversations (org_id, owner_id, last_message_at desc);

create table messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender_name text, body text, attachments jsonb not null default '[]',
  external_id text, sent_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);
create index on messages (conversation_id, sent_at);

create table partner_notes (               -- timeline: notes, status changes, deal events
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  partner_id uuid not null references partners on delete cascade,
  kind text not null default 'note', body text not null,
  author_id uuid references members, created_at timestamptz not null default now()
);

create table automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null, enabled boolean not null default true,
  trigger jsonb not null,                    -- {"type":"metric_drop","pct":30,...}
  audience jsonb not null default '{}',
  actions jsonb not null default '[]',
  runs int not null default 0, last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  member_id uuid not null references members on delete cascade,
  title text not null, body text, href text,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index on notifications (member_id, read_at);

create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations on delete cascade,
  actor_id uuid references members, action text not null,
  entity text, entity_id uuid, meta jsonb,
  created_at timestamptz not null default now()
);

-- Realtime for the inbox.
alter publication supabase_realtime add table messages, conversations, notifications;
