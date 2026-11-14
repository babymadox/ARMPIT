import { supabaseAdmin } from "./supabase/admin";

/** Credentials are JSON in Vault; only the opaque secret id is stored on tracker_connections. */
export async function storeCreds(name: string, creds: Record<string, string>) {
  const { data, error } = await supabaseAdmin().rpc("store_secret", { secret: JSON.stringify(creds), secret_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function readCreds(secretId: string | null): Promise<Record<string, string>> {
  if (!secretId) return {};
  const { data, error } = await supabaseAdmin().rpc("read_secret", { secret_id: secretId });
  if (error) throw new Error(error.message);
  return JSON.parse(data as string);
}
