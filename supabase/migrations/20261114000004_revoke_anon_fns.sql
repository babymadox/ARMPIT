-- Supabase grants EXECUTE to anon by default. These functions are for signed-in users only.
-- (The RLS helpers must stay executable by `authenticated`: policies evaluate them as the invoker.)
revoke execute on function public.claim_invites(), public.create_organization(text, text),
  public.is_org_admin(uuid), public.my_member_id(uuid), public.my_orgs() from anon, public;
grant execute on function public.claim_invites(), public.create_organization(text, text),
  public.is_org_admin(uuid), public.my_member_id(uuid), public.my_orgs() to authenticated;
