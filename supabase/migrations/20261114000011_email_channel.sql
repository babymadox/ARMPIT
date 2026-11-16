-- Email channel: any mailbox over IMAP/SMTP (Gmail, Outlook, Yahoo, iCloud, company domains).
alter type channel_kind add value if not exists 'email';

-- Poll bookkeeping per connection: IMAP position (uid validity + last uid), when it was last checked, and the last error.
alter table channel_connections add column if not exists sync_state jsonb;
alter table channel_connections add column if not exists last_polled_at timestamptz;
alter table channel_connections add column if not exists last_error text;

-- Mail has subjects; chat messages do not.
alter table messages add column if not exists subject text;

-- Lets the server delete a stored credential when a mailbox is disconnected (only secrets named "<org_id>:...").
create or replace function public.delete_secret(secret_id uuid, org uuid) returns void
language sql security definer set search_path = public, vault as $$
  delete from vault.secrets where id = secret_id and name like org::text || ':%'
$$;
revoke all on function public.delete_secret(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_secret(uuid, uuid) to service_role;
