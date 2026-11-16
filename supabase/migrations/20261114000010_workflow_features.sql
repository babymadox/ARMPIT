-- Workflow features: conversation recency, private notifications, payment decisions, admin-only audit log,
-- and server-side aggregates (Supabase caps every query at 1000 rows, so totals must be computed in SQL).

-- 1) Who spoke last and when the partner last wrote (silent-partner and no-reply automations)
alter table conversations add column if not exists last_direction text check (last_direction in ('in','out'));
alter table conversations add column if not exists last_inbound_at timestamptz;
update conversations c set
  last_direction  = (select m.direction from messages m where m.conversation_id = c.id order by m.sent_at desc limit 1),
  last_inbound_at = (select max(m.sent_at) from messages m where m.conversation_id = c.id and m.direction = 'in')
where c.last_direction is null;

-- 2) Notifications are private to their recipient and can be de-duplicated
alter table notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key on notifications (member_id, dedupe_key);   -- NULL keys never collide
drop policy if exists "org read" on notifications;
drop policy if exists "org write" on notifications;
drop policy if exists "own read" on notifications;
drop policy if exists "own update" on notifications;
create policy "own read"   on notifications for select using (member_id = my_member_id(org_id));
create policy "own update" on notifications for update using (member_id = my_member_id(org_id)) with check (member_id = my_member_id(org_id));
-- No insert/delete policy: notifications are created by the server only.

-- 3) Payment decisions
alter table payments add column if not exists agreed_amount numeric;
alter table payments add column if not exists decision text;
alter table payments add column if not exists decided_by uuid references members on delete set null;
alter table payments add column if not exists decided_at timestamptz;
drop trigger if exists same_org_guard on payments;
create trigger same_org_guard before insert or update on payments for each row
  execute function public.enforce_same_org('partner_id:partners', 'deal_id:deals', 'owner_id:members', 'decided_by:members');

-- 4) The audit log is for admins only (it was readable by every member)
drop policy if exists "org read" on audit_log;
drop policy if exists "admins read audit" on audit_log;
create policy "admins read audit" on audit_log for select using (is_org_admin(org_id));
create index if not exists audit_log_org_time on audit_log (org_id, created_at desc);

-- 5) Aggregates computed in SQL (no row cap). RLS still applies to signed-in callers.
create or replace function public.link_metric_totals(p_partner uuid, p_since date)
returns table (link_id uuid, metric text, total numeric)
language sql stable set search_path = public as $$
  select s.link_id, s.metric, sum(s.value)
  from tracker_stats s join partner_links l on l.id = s.link_id
  where l.partner_id = p_partner and s.day >= p_since
  group by s.link_id, s.metric
$$;
create or replace function public.partner_metric_sums(p_org uuid, p_metric text, p_from date, p_to date)
returns table (partner_id uuid, total numeric)
language sql stable set search_path = public as $$
  select l.partner_id, sum(s.value)
  from tracker_stats s join partner_links l on l.id = s.link_id
  where s.org_id = p_org and l.org_id = p_org and s.metric = p_metric and s.day between p_from and p_to
  group by l.partner_id
$$;
revoke all on function public.link_metric_totals(uuid, date), public.partner_metric_sums(uuid, text, date, date) from public, anon;
grant execute on function public.link_metric_totals(uuid, date), public.partner_metric_sums(uuid, text, date, date) to authenticated, service_role;
