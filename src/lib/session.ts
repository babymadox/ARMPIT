import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export type Role = "owner_admin" | "admin" | "member";

/** Resolves the signed-in user's active membership. Redirects to onboarding if they have no org yet. */
export async function requireSession() {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  await db.rpc("claim_invites");
  const { data: member } = await db.from("members").select("*, organizations(*)").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
  if (!member) redirect("/onboarding");
  return { db, user, member, org: member.organizations as { id: string; name: string; plan: string; seats: number }, isAdmin: member.role !== "member" };
}
