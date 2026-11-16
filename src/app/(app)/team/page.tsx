import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site";
import { Chip } from "@/components/Chip";
import { PageHeader } from "@/components/ui";
import { parse, inviteSchema } from "@/lib/validation";
import { classifyInviteError } from "@/lib/invite";
import { audit } from "@/lib/audit";
import { errMsg, logEvent } from "@/lib/log";
import { ago } from "@/lib/format";

export const maxDuration = 30;
const back = (msg: string) => redirect(`/team?msg=${encodeURIComponent(msg)}`);

/** Sends the invite email through Supabase Auth. The link lands on /auth/accept where the person sets a password. */
async function sendInvite(orgId: string, email: string, actor: string) {
  const origin = await siteOrigin();
  const { error } = await supabaseAdmin().auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/auth/accept` });
  if (!error) { await logEvent({ orgId, level: "info", source: "team.invite", message: "invite email sent", details: { by: actor } }); return { ok: true as const }; }
  const kind = classifyInviteError(error.message);
  await logEvent({ orgId, level: kind === "exists" ? "info" : "warn", source: "team.invite", message: `invite email not sent (${kind}): ${errMsg(error.message)}` });
  return { ok: false as const, kind, message: error.message };
}
const explain = (r: Awaited<ReturnType<typeof sendInvite>>) => r.ok ? "Invite email sent." : r.kind === "exists" ? "They already have an account: they can just sign in and will join automatically." : r.kind === "rate_limited" ? "The invite is saved but the email service is rate limited. Use Resend in a minute." : `The invite is saved but the email could not be sent (${errMsg(r.message)}). Use Resend to try again.`;

async function invite(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can invite people");
  const r = parse(inviteSchema, fd); if (!r.ok) return back(`Could not invite: ${r.error}`);
  const { count } = await db.from("members").select("id", { count: "exact", head: true }).eq("org_id", org.id).neq("status", "suspended");
  if ((count ?? 0) >= org.seats) return back("No free seats. Add seats in Billing.");
  const { data: row, error } = await db.from("members").insert({ org_id: org.id, email: r.data.email, role: r.data.role, status: "invited" }).select("id").single();
  if (error) return back(error.code === "23505" ? "That email has already been invited" : `Could not invite: ${error.message}`);
  const sent = await sendInvite(org.id, r.data.email, member.id);
  await audit({ orgId: org.id, actorId: member.id, action: "member.invite", entity: "member", entityId: row.id, meta: { email: r.data.email, role: r.data.role, emailed: sent.ok } });
  revalidatePath("/team"); back(`${r.data.email} invited. ${explain(sent)}`);
}
async function resend(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can resend invites");
  const { data: m } = await db.from("members").select("id,email").eq("id", String(fd.get("id"))).eq("status", "invited").maybeSingle();
  if (!m) return back("That invite no longer exists");
  const sent = await sendInvite(org.id, m.email, member.id);
  await audit({ orgId: org.id, actorId: member.id, action: "member.invite_resend", entity: "member", entityId: m.id, meta: { email: m.email, emailed: sent.ok } });
  back(`${m.email}: ${explain(sent)}`);
}
async function revoke(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can revoke invites");
  const id = String(fd.get("id"));
  const { data: m } = await db.from("members").select("id,email").eq("id", id).eq("status", "invited").is("user_id", null).maybeSingle();   // never remove someone who has joined
  if (!m) return back("That invite no longer exists");
  const { error } = await db.from("members").delete().eq("id", id);
  if (error) return back(`Could not revoke: ${error.message}`);
  await audit({ orgId: org.id, actorId: member.id, action: "member.invite_revoke", entity: "member", entityId: id, meta: { email: m.email } });
  revalidatePath("/team"); back(`Invite for ${m.email} revoked`);
}

export default async function Team({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { db, isAdmin, org } = await requireSession();
  const { data: rows = [], error } = await db.from("members").select("id,full_name,email,role,status,team_name,last_seen_at,created_at").order("created_at");
  const used = (rows ?? []).filter((m: any) => m.status !== "suspended").length;
  return (
    <>
      <PageHeader title="Team" sub={`${used} of ${org.seats} seats used`} />
      {msg && <div className="notice" role="status">{msg}</div>}
      {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)" }}>{error.message}</div>}
      {isAdmin && <form className="row" action={invite}><input name="email" type="email" placeholder="Email address" required style={{ minWidth: 260 }} /><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select><button className="pri">Send invite</button></form>}
      <div className="card scroll"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last seen</th>{isAdmin && <th />}</tr></thead><tbody>{(rows ?? []).map((m: any) => (
        <tr key={m.id}><td><b>{m.full_name ?? m.email}</b><div className="mut">{m.email}</div></td><td>{m.role.replace("_", " ")}</td><td><Chip v={m.status} /></td><td className="mut">{m.last_seen_at ? ago(m.last_seen_at) : "—"}</td>
          {isAdmin && <td>{m.status === "invited" && <div className="row" style={{ margin: 0, flexWrap: "nowrap" }}><form action={resend}><input type="hidden" name="id" value={m.id} /><button>Resend</button></form><form action={revoke}><input type="hidden" name="id" value={m.id} /><button>Revoke</button></form></div>}</td>}</tr>))}</tbody></table></div>
    </>
  );
}
