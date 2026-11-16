import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readCreds } from "@/lib/secrets";
import { siteOrigin } from "@/lib/site";
import { Chip } from "@/components/Chip";
import { CopyText } from "@/components/CopyText";
import { PageHeader } from "@/components/ui";
import { parse, inviteSchema } from "@/lib/validation";
import { classifyInviteError } from "@/lib/invite";
import { sendMail } from "@/lib/email/smtp";
import { audit } from "@/lib/audit";
import { errMsg, logEvent } from "@/lib/log";
import { ago } from "@/lib/format";

export const maxDuration = 30;
const back = (msg: string) => redirect(`/team?msg=${encodeURIComponent(msg)}`);
const FLASH = "invite_flash";

/**
 * Creates a one-time sign-in link for the person. Supabase's built-in email service is limited (it is meant for your own
 * team and is rate limited), so ARMPIT does not rely on it: it makes the link itself, emails it from the inviter's own
 * connected mailbox when there is one, and always shows the link to the inviter to copy.
 */
async function makeLink(email: string, origin: string) {
  const admin = supabaseAdmin().auth.admin, redirectTo = `${origin}/auth/accept`;
  let r = await admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (r.error && classifyInviteError(r.error.message) === "exists") r = await admin.generateLink({ type: "magiclink", email, options: { redirectTo } });   // they already have an account: a sign-in link
  const link = r.data?.properties?.action_link;
  return link ? { ok: true as const, link } : { ok: false as const, message: r.error?.message ?? "No link was returned" };
}

/** Emails the link from the inviter's own connected mailbox. Returns false (and says why) when that is not possible. */
async function emailFromInviter(orgId: string, actorId: string, to: string, link: string, orgName: string, actorName: string): Promise<{ sent: boolean; why?: string }> {
  const { data: box } = await supabaseAdmin().from("channel_connections").select("vault_secret_id").eq("org_id", orgId).eq("member_id", actorId).eq("kind", "email").eq("status", "connected").limit(1).maybeSingle();
  if (!box) return { sent: false, why: "You have no connected mailbox, so the email was not sent." };
  try {
    await sendMail(await readCreds(box.vault_secret_id, orgId), { to, subject: `${actorName} invited you to ${orgName} on ARMPIT`,
      text: `Hi,\n\n${actorName} invited you to join ${orgName} on ARMPIT.\n\nOpen this link to set your password and sign in:\n${link}\n\nThe link works once and expires after a short time. If it has expired, ask ${actorName} to send a new invite.\n` });
    return { sent: true };
  } catch (e) { return { sent: false, why: `The email could not be sent (${errMsg(e)}).` }; }
}

async function deliver(orgId: string, actorId: string, actorName: string, orgName: string, email: string) {
  const l = await makeLink(email, await siteOrigin());
  if (!l.ok) { await logEvent({ orgId, level: "warn", source: "team.invite", message: `invite link not created: ${errMsg(l.message)}` }); return { ok: false as const, message: l.message }; }
  const mail = await emailFromInviter(orgId, actorId, email, l.link, orgName, actorName);
  await logEvent({ orgId, level: "info", source: "team.invite", message: "invite link created", details: { emailed: mail.sent } });
  // The link is shown once to the inviter (short-lived, httpOnly cookie) and never put in a URL.
  (await cookies()).set(FLASH, JSON.stringify({ email, link: l.link, emailed: mail.sent }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/team" });
  return { ok: true as const, emailed: mail.sent, why: mail.why };
}
const note = (email: string, r: Awaited<ReturnType<typeof deliver>>) => !r.ok ? `The invite for ${email} is saved but no link could be created (${errMsg(r.message)}). Try Resend.` : r.emailed ? `${email} invited. An email with the link was sent from your mailbox, and the link is below too.` : `${email} invited. ${r.why} Copy the link below and send it to them yourself.`;

async function invite(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can invite people");
  const r = parse(inviteSchema, fd); if (!r.ok) return back(`Could not invite: ${r.error}`);
  const { count } = await db.from("members").select("id", { count: "exact", head: true }).eq("org_id", org.id).neq("status", "suspended");
  if ((count ?? 0) >= org.seats) return back("No free seats. Add seats in Billing.");
  const { data: row, error } = await db.from("members").insert({ org_id: org.id, email: r.data.email, role: r.data.role, status: "invited" }).select("id").single();
  if (error) return back(error.code === "23505" ? "That email has already been invited. Use Resend to make a new link." : `Could not invite: ${error.message}`);
  const sent = await deliver(org.id, member.id, member.full_name ?? member.email, org.name, r.data.email);
  await audit({ orgId: org.id, actorId: member.id, action: "member.invite", entity: "member", entityId: row.id, meta: { email: r.data.email, role: r.data.role, emailed: sent.ok && sent.emailed } });
  revalidatePath("/team"); back(note(r.data.email, sent));
}
async function resend(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can resend invites");
  const { data: m } = await db.from("members").select("id,email").eq("id", String(fd.get("id"))).eq("status", "invited").maybeSingle();
  if (!m) return back("That invite no longer exists");
  const sent = await deliver(org.id, member.id, member.full_name ?? member.email, org.name, m.email);
  await audit({ orgId: org.id, actorId: member.id, action: "member.invite_resend", entity: "member", entityId: m.id, meta: { email: m.email, emailed: sent.ok && sent.emailed } });
  back(note(m.email, sent));
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
async function hideLink() { "use server"; await requireSession(); (await cookies()).delete(FLASH); revalidatePath("/team"); }

export default async function Team({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { db, isAdmin, org } = await requireSession();
  const { data: rows = [], error } = await db.from("members").select("id,full_name,email,role,status,team_name,last_seen_at,created_at").order("created_at");
  const used = (rows ?? []).filter((m: any) => m.status !== "suspended").length;
  let flash: { email: string; link: string; emailed: boolean } | null = null;
  if (isAdmin) { try { flash = JSON.parse((await cookies()).get(FLASH)?.value ?? "null"); } catch { flash = null; } }
  return (
    <>
      <PageHeader title="Team" sub={`${used} of ${org.seats} seats used`} />
      {msg && <div className="notice" role="status">{msg}</div>}
      {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)" }}>{error.message}</div>}
      {flash && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="between"><b>Invite link for {flash.email}</b><form action={hideLink}><button>Hide</button></form></div>
          <p className="mut" style={{ margin: "6px 0 10px" }}>{flash.emailed ? "Already emailed from your mailbox. " : ""}This link signs them in once so they can set a password. Anyone with the link can join, so only share it with them. It expires after a short time: press Resend for a new one.</p>
          <CopyText value={flash.link} />
        </div>)}
      {isAdmin && <form className="row" action={invite}><input name="email" type="email" placeholder="Email address (any provider)" required style={{ minWidth: 280 }} /><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select><button className="pri">Invite</button></form>}
      <div className="card scroll"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last seen</th>{isAdmin && <th />}</tr></thead><tbody>{(rows ?? []).map((m: any) => (
        <tr key={m.id}><td><b>{m.full_name ?? m.email}</b><div className="mut">{m.email}</div></td><td>{m.role.replace("_", " ")}</td><td><Chip v={m.status} /></td><td className="mut">{m.last_seen_at ? ago(m.last_seen_at) : "—"}</td>
          {isAdmin && <td>{m.status === "invited" && <div className="row" style={{ margin: 0, flexWrap: "nowrap" }}><form action={resend}><input type="hidden" name="id" value={m.id} /><button>Resend</button></form><form action={revoke}><input type="hidden" name="id" value={m.id} /><button>Revoke</button></form></div>}</td>}</tr>))}</tbody></table></div>
    </>
  );
}
