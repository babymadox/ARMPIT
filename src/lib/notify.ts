import { supabaseAdmin } from "./supabase/admin";
import { errMsg } from "./scrub.ts";
import { logEvent } from "./log";

type N = { orgId: string; memberId: string; title: string; body?: string; href?: string; dedupeKey?: string };
const safeHref = (h?: string) => (h && h.startsWith("/") && !h.startsWith("//") ? h : null);   // internal links only

/** Creates a notification for one member (de-duplicated when dedupeKey is given). Never throws. */
export async function notify(n: N): Promise<boolean> {
  try {
    const row = { org_id: n.orgId, member_id: n.memberId, title: n.title.slice(0, 160), body: n.body?.slice(0, 300) ?? null, href: safeHref(n.href), dedupe_key: n.dedupeKey ?? null };
    const q = supabaseAdmin().from("notifications");
    const { data, error } = n.dedupeKey ? await q.upsert(row, { onConflict: "member_id,dedupe_key", ignoreDuplicates: true }).select("id") : await q.insert(row).select("id");
    if (error) { await logEvent({ orgId: n.orgId, level: "warn", source: "notify", message: errMsg(error.message) }); return false; }
    return !!data?.length;
  } catch (e) { await logEvent({ orgId: n.orgId, level: "warn", source: "notify", message: errMsg(e) }); return false; }
}

/** Notifies every active admin of the workspace, optionally skipping the person who caused the event. */
export async function notifyAdmins(orgId: string, n: Omit<N, "orgId" | "memberId">, exceptMemberId?: string | null): Promise<void> {
  try {
    const { data } = await supabaseAdmin().from("members").select("id").eq("org_id", orgId).eq("status", "active").in("role", ["owner_admin", "admin"]);
    await Promise.all((data ?? []).filter((m) => m.id !== exceptMemberId).map((m) => notify({ ...n, orgId, memberId: m.id })));
  } catch (e) { await logEvent({ orgId, level: "warn", source: "notify", message: errMsg(e) }); }
}
