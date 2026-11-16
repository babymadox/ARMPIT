-- Activation codes: creating a workspace requires a one-time code that only the operator can issue.
--
-- Where the protection lives: in the database, not in the app. The table below has row level security enabled and NO
-- policies, so no signed-in user (not even a workspace admin) can read or write it. Codes are inserted by the operator's
-- server-side admin endpoint (service role) and redeemed inside create_organization(), a SECURITY DEFINER function.
-- Only a hash of each code is stored, so a database leak does not reveal usable codes.
create table if not exists activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,                                  -- sha256 of the normalised code (see redeem_activation_code)
  label text,                                                      -- the operator's note, e.g. who it was sold to
  status text not null default 'issued' check (status in ('issued','redeemed','revoked')),
  org_id uuid references organizations on delete set null,         -- the workspace the code created
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);
alter table activation_codes enable row level security;
-- Deliberately no policies: deny-all for anon and authenticated. The service role bypasses RLS.

-- Normalisation MUST match src/lib/activation.ts: keep letters and digits only, upper-case, then sha256 as hex.
create or replace function public.redeem_activation_code(raw_code text, p_org uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text; n int;
begin
  if raw_code is null or length(trim(raw_code)) = 0 then return false; end if;
  h := encode(digest(upper(regexp_replace(raw_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
  -- One atomic statement: two people racing with the same code cannot both succeed, and revoked codes never match.
  update activation_codes set status = 'redeemed', redeemed_at = now(), org_id = p_org where code_hash = h and status = 'issued';
  get diagnostics n = row_count;
  return n = 1;
end $$;
-- Not callable from the API at all: it is reachable only through create_organization() below.
revoke all on function public.redeem_activation_code(text, uuid) from public, anon, authenticated;

-- The old two-argument sign-up function is removed so there is no way to create a workspace without a code.
drop function if exists public.create_organization(text, text);
create or replace function public.create_organization(org_name text, full_name text, activation_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid := gen_random_uuid(); u auth.users;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null then raise exception 'not signed in'; end if;
  insert into organizations(id, name) values (o, org_name);
  -- The code is tied to the workspace it creates, so the workspace row must exist first. If the code is wrong, used or
  -- revoked the exception below aborts the whole call and the database undoes every insert: nothing is left behind.
  if not public.redeem_activation_code(activation_code, o) then raise exception 'That activation code is not valid, or has already been used'; end if;
  insert into members(org_id,user_id,email,full_name,role,status) values (o,u.id,u.email,full_name,'owner_admin','active');
  insert into partner_statuses(org_id,name,color,position) values
    (o,'Negotiating','#f59e0b',0),(o,'Waiting on docs','#a855f7',1),(o,'Onboarding','#3b82f6',2),
    (o,'Deal agreed','#14b8a6',3),(o,'Approval','#8b5cf6',4),(o,'Live','#10b981',5),(o,'Paused','#94a3b8',6);
  return o;
end $$;
revoke all on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;
