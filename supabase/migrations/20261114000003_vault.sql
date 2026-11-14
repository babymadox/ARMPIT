-- Provider credentials live in Supabase Vault. Only the service role may store or read them.
create extension if not exists supabase_vault with schema vault;

create or replace function public.store_secret(secret text, secret_name text) returns uuid
language sql security definer set search_path = public, vault as $$
  select vault.create_secret(secret, secret_name)
$$;
create or replace function public.read_secret(secret_id uuid) returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = secret_id
$$;
revoke all on function public.store_secret(text, text), public.read_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_secret(text, text), public.read_secret(uuid) to service_role;
