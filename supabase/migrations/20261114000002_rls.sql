-- Row level security: a user only ever sees rows of orgs where they are an active member.
create or replace function public.my_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from members where user_id = auth.uid() and status = 'active'
$$;
create or replace function public.is_org_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = auth.uid()
                 and status = 'active' and role in ('owner_admin','admin'))
$$;
create or replace function public.my_member_id(o uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where org_id = o and user_id = auth.uid() and status = 'active'
$$;

-- Generic org-scoped tables: members read/write inside their org.
do $$
declare t text;
begin
  foreach t in array array['partner_statuses','partners','tracker_connections','partner_links','tracker_stats',
    'deals','payments','payment_adjustments','tasks','partner_notes','notifications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "org read"  on %I for select using (org_id in (select my_orgs()))', t);
    execute format('create policy "org write" on %I for all    using (org_id in (select my_orgs())) with check (org_id in (select my_orgs()))', t);
  end loop;
end $$;

-- Admin-only tables.
do $$
declare t text;
begin
  foreach t in array array['automations','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "org read" on %I for select using (org_id in (select my_orgs()))', t);
  end loop;
end $$;
create policy "admin write" on automations for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

alter table organizations enable row level security;
create policy "member read" on organizations for select using (id in (select my_orgs()));
create policy "admin update" on organizations for update using (is_org_admin(id));

alter table members enable row level security;
create policy "org read" on members for select using (org_id in (select my_orgs()) or user_id = auth.uid());
create policy "admin manage" on members for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- Inbox privacy: admins see every chat; members only chats they own.
alter table channel_connections enable row level security;
create policy "own or admin" on channel_connections for all
  using (is_org_admin(org_id) or member_id = my_member_id(org_id));

alter table conversations enable row level security;
create policy "own or admin" on conversations for all
  using (is_org_admin(org_id) or owner_id = my_member_id(org_id))
  with check (is_org_admin(org_id) or owner_id = my_member_id(org_id));

alter table messages enable row level security;
create policy "via conversation" on messages for all
  using (exists (select 1 from conversations c where c.id = conversation_id
        and (is_org_admin(c.org_id) or c.owner_id = my_member_id(c.org_id))))
  with check (exists (select 1 from conversations c where c.id = conversation_id
        and (is_org_admin(c.org_id) or c.owner_id = my_member_id(c.org_id))));

-- Sign-up: create an org and make the caller its owner in one call.
create or replace function public.create_organization(org_name text, full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; u auth.users;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null then raise exception 'not signed in'; end if;
  insert into organizations(name) values (org_name) returning id into o;
  insert into members(org_id,user_id,email,full_name,role,status)
    values (o,u.id,u.email,full_name,'owner_admin','active');
  insert into partner_statuses(org_id,name,color,position) values
    (o,'Negotiating','#f59e0b',0),(o,'Waiting on docs','#a855f7',1),(o,'Onboarding','#3b82f6',2),
    (o,'Deal agreed','#14b8a6',3),(o,'Approval','#8b5cf6',4),(o,'Live','#10b981',5),(o,'Paused','#94a3b8',6);
  return o;
end $$;
revoke all on function public.create_organization from public;
grant execute on function public.create_organization to authenticated;

-- Invited teammates: on first sign-in, attach the auth user to any pending invites for their email.
create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update members set user_id = auth.uid(), status = 'active'
   where status = 'invited' and user_id is null
     and lower(email) = lower((select email from auth.users where id = auth.uid()));
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.claim_invites to authenticated;
