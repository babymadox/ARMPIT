import { supabaseAdmin } from "./supabase/admin";

/** Credentials are JSON in Vault; only the opaque secret id is stored on tracker_connections. */
export async function storeCreds(name: string, creds: Record<string, string>) {
  const { data, error } = await supabaseAdmin().rpc("store_secret", { secret: JSON.stringify(creds), secret_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}
/** Reads credentials only if they were stored by `orgId` (secret names start with the workspace id). */
export async function readCreds(secretId: string | null, orgId: string): Promise<Record<string, string>> {
  if (!secretId) return {};
  const { data, error } = await supabaseAdmin().rpc("read_secret_for_org", { secret_id: secretId, org: orgId });
  if (error) throw new Error(error.message);
  if (data == null) throw new Error("Credentials not found for this workspace");
  return JSON.parse(data as string);
}
