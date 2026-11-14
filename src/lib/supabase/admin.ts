import { createClient } from "@supabase/supabase-js";

/** Service-role client. Bypasses RLS: only for webhooks and cron jobs, always scoping by org_id yourself. */
export function supabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
