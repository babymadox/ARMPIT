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
