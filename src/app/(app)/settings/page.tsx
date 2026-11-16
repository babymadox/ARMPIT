import { requireSession } from "@/lib/session";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Chip } from "@/components/Chip";
import { trackers as adapters, channels } from "@/lib/integrations";
import { readCreds, storeCreds } from "@/lib/secrets";
import { siteOrigin, webhookUrl } from "@/lib/site";
import { PageHeader } from "@/components/ui";
import { errMsg, logEvent } from "@/lib/log";
import { audit } from "@/lib/audit";
import { parse, emailConnectSchema } from "@/lib/validation";
import { detectProvider, PRESETS } from "@/lib/email/presets";
import { pollConnection } from "@/lib/mail";
import { ago } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function connectTracker(fd: FormData) {
  "use server";
  const { org, member, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const kind = String(fd.get("kind")) as keyof typeof adapters;
  const creds = { api_key: String(fd.get("api_key")) };
  const test = await adapters[kind].test(creds);                 // never save a key that does not work
  if (!test.ok) throw new Error(`Could not connect: ${test.error}`);
  const secret = await storeCreds(`${org.id}:${kind}`, creds);
  const { error } = await supabaseAdmin().from("tracker_connections").insert({ org_id: org.id, kind, label: String(fd.get("label") || kind), vault_secret_id: secret });
  if (error) return back(`Could not save the connection: ${error.message}`);
  await logEvent({ orgId: org.id, level: "info", source: "tracker.connect", message: `${kind} connected` });
  await audit({ orgId: org.id, actorId: member.id, action: "tracker.connect", entity: "tracker", meta: { kind } });
  revalidatePath("/settings");
}

export const maxDuration = 30;
const back = (msg: string) => redirect(`/settings?msg=${encodeURIComponent(msg)}#channels`);

/** Telegram: validate the bot token, register the webhook, then keep the token in Vault. Nothing is kept if any step fails. */
async function connectTelegram(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const { count } = await db.from("channel_connections").select("id", { count: "exact", head: true }).eq("kind", "telegram");
  if (count) return back("Telegram is already connected. Disconnect it first to use a different bot.");
  const { data: row, error } = await db.from("channel_connections").insert({ org_id: org.id, member_id: member.id, kind: "telegram", status: "connecting" }).select("id").single();
  if (error || !row) return back(error?.message ?? "Could not start the connection");
  try {
    const url = webhookUrl(await siteOrigin(), "telegram", row.id);
    if (!url.startsWith("https://")) throw new Error("Telegram needs a public https address. Connect from your deployed site, not localhost.");
    const { account, creds } = await channels.telegram.connect({ bot_token: String(fd.get("token") ?? "").trim() }, url);
    const secret = await storeCreds(`${org.id}:telegram:${row.id}`, creds);
    const { error: upErr } = await supabaseAdmin().from("channel_connections").update({ vault_secret_id: secret, external_account: account, status: "connected" }).eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
  } catch (e) {
    await db.from("channel_connections").delete().eq("id", row.id);          // best effort: no half-connected state
    await logEvent({ orgId: org.id, level: "warn", source: "channel.telegram", message: `connect failed: ${errMsg(e)}` });
    return back(`Could not connect: ${e instanceof Error ? e.message : e}`);
  }
  await logEvent({ orgId: org.id, level: "info", source: "channel.telegram", message: "connected" });
  await audit({ orgId: org.id, actorId: member.id, action: "channel.connect", entity: "channel", meta: { channel: "telegram" } });
  revalidatePath("/settings"); revalidatePath("/inbox");
  back("Telegram connected. Now add the bot to a partner group and send a message.");
}

async function disconnectTelegram(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const id = String(fd.get("id"));
  const { data: c } = await db.from("channel_connections").select("id,vault_secret_id").eq("id", id).maybeSingle();
  if (c) { try { await channels.telegram.disconnect(await readCreds(c.vault_secret_id, org.id)); } catch { /* best effort */ } const { error } = await db.from("channel_connections").delete().eq("id", id); if (error) return back(`Could not disconnect: ${error.message}`); }
  await logEvent({ orgId: org.id, level: "info", source: "channel.telegram", message: "disconnected" });
  await audit({ orgId: org.id, actorId: member.id, action: "channel.disconnect", entity: "channel", meta: { channel: "telegram" } });
  revalidatePath("/settings"); revalidatePath("/inbox");
  back("Telegram disconnected. Existing conversations are kept.");
}


/** Any member can connect their OWN mailbox (Gmail, Outlook, Yahoo, iCloud or a company domain). The password goes straight into Vault. */
async function connectEmail(fd: FormData) {
  "use server";
  const { db, org, member } = await requireSession();
  const r = parse(emailConnectSchema, fd);
  if (!r.ok) return back(`Could not connect the mailbox: ${r.error}`);
  const d = r.data, preset = detectProvider(d.email);
  const { data: existing } = await db.from("channel_connections").select("id,external_account,member_id").eq("kind", "email");
  if ((existing ?? []).some((c: any) => c.external_account === d.email)) return back("That mailbox is already connected");
  if ((existing ?? []).filter((c: any) => c.member_id === member.id).length >= 5) return back("You can connect up to 5 mailboxes");
  const creds = { email: d.email, username: d.username ?? "", password: d.password, name: member.full_name ?? "",
    imap_host: d.imap_host ?? preset.imap.host, imap_port: String(d.imap_port ?? preset.imap.port), smtp_host: d.smtp_host ?? preset.smtp.host, smtp_port: String(d.smtp_port ?? preset.smtp.port) };
  const { data: row, error } = await db.from("channel_connections").insert({ org_id: org.id, member_id: member.id, kind: "email", status: "connecting" }).select("id").single();
  if (error || !row) return back(`Could not connect the mailbox: ${error?.message}`);
  try {
    await channels.email.connect(creds, "");                                     // signs in to both servers; nothing is saved if either fails
    const secret = await storeCreds(`${org.id}:email:${row.id}`, creds);
    const { error: upErr } = await supabaseAdmin().from("channel_connections").update({ vault_secret_id: secret, external_account: d.email, status: "connected" }).eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
  } catch (e) {
    await db.from("channel_connections").delete().eq("id", row.id);          // best effort: no half-connected state
    await logEvent({ orgId: org.id, level: "warn", source: "channel.email", message: `connect failed: ${errMsg(e)}`, details: { provider: preset.id } });
    return back(`Could not connect ${d.email}: ${e instanceof Error ? e.message : e}`);
  }
  await logEvent({ orgId: org.id, level: "info", source: "channel.email", message: "mailbox connected", details: { provider: preset.id } });
  await audit({ orgId: org.id, actorId: member.id, action: "channel.connect", entity: "channel", meta: { channel: "email", provider: preset.id, address: d.email } });
  let first = "";
  try { const o = await pollConnection({ orgId: org.id }, row.id, { minIntervalSec: 0, force: true }); first = ` Imported ${o.imported} recent message(s).`; }
  catch (e) { first = ` Connected, but the first check failed: ${errMsg(e)}`; }
  revalidatePath("/settings"); revalidatePath("/inbox");
  back(`${d.email} connected.${first}`);
}
async function disconnectEmail(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  const id = String(fd.get("id"));
  const { data: c } = await db.from("channel_connections").select("id,member_id,vault_secret_id,external_account").eq("id", id).eq("kind", "email").maybeSingle();
  if (!c) return back("Mailbox not found");
  if (!isAdmin && c.member_id !== member.id) return back("You can only disconnect your own mailbox");
  const { error } = await db.from("channel_connections").delete().eq("id", id);
  if (error) return back(`Could not disconnect: ${error.message}`);
  if (c.vault_secret_id) await supabaseAdmin().rpc("delete_secret", { secret_id: c.vault_secret_id, org: org.id });   // best effort: remove the stored password
  await audit({ orgId: org.id, actorId: member.id, action: "channel.disconnect", entity: "channel", meta: { channel: "email", address: c.external_account } });
  revalidatePath("/settings"); revalidatePath("/inbox");
  back(`${c.external_account} disconnected. Existing conversations are kept.`);
}
async function checkMail(fd: FormData) {
  "use server";
  const { db, org } = await requireSession();
  const id = String(fd.get("id"));
  const { data: c } = await db.from("channel_connections").select("id").eq("id", id).eq("kind", "email").maybeSingle();   // RLS: own mailbox or admin
  if (!c) return back("Mailbox not found");
  try { const o = await pollConnection({ orgId: org.id }, id, { minIntervalSec: 0, force: true }); revalidatePath("/settings"); revalidatePath("/inbox"); back(`Checked: ${o.imported} new message(s).`); }
  catch (e) { back(`Could not check mail: ${errMsg(e)}`); }
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { db, org, member, isAdmin } = await requireSession();
  const [{ data: trackers = [] }, { data: audit = [] }, { data: tg = [] }, { data: boxes = [] }] = await Promise.all([
    db.from("tracker_connections").select("id,kind,label,status,last_synced_at"),
    isAdmin ? db.from("audit_log").select("id,action,entity,created_at,actor:members(full_name,email)").order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    db.from("channel_connections").select("id,external_account,status,vault_secret_id").eq("kind", "telegram"),
    db.from("channel_connections").select("id,external_account,status,last_polled_at,last_error,member_id,member:members(full_name)").eq("kind", "email").order("created_at"),
  ]);
  const tgConn: any = tg![0];
  let tgStatus: { ok: boolean; detail: string } | null = null;
  if (tgConn && isAdmin) {   // live health check against Telegram, so a broken webhook is visible instead of silent
    try { tgStatus = await channels.telegram.status(await readCreds(tgConn.vault_secret_id, org.id), webhookUrl(await siteOrigin(), "telegram", tgConn.id)); }
    catch (e) { tgStatus = { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
  }
  return (
    <>
      <PageHeader title="Settings" />
      {msg && <div className="notice" role="status">{msg}</div>}
      <div className="card"><h2>Organization</h2><p>{org.name} · {org.plan} plan · {org.seats} seats</p></div>
      <h2>Integrations</h2>
      {isAdmin && <form className="row" action={connectTracker}>
        <select name="kind"><option value="singular">Singular</option></select>
        <input name="label" placeholder="Label (optional)" /><input name="api_key" type="password" placeholder="API key" required />
        <button className="pri">Connect</button></form>}
      <div className="card">{trackers!.map((t: any) => <p key={t.id}>{t.label ?? t.kind} <Chip v={t.status} /> <Link href={`/settings/integrations/${t.id}`}>Agencies & sources →</Link></p>)}{!trackers!.length && <span className="mut">No trackers connected. Adapters live in src/lib/integrations/trackers.</span>}</div>
      <h2 id="channels">Channels</h2>
      <div className="card">
        <div className="between"><b>Telegram</b>{tgConn ? <span className={`pill ${tgStatus?.ok ? "ok" : "warn"}`}>{tgStatus ? (tgStatus.ok ? "Working" : "Needs attention") : "Connected"}</span> : <span className="pill">Not connected</span>}</div>
        {tgConn ? (
          <>
            <p className="mut">Bot {tgConn.external_account}{tgStatus ? ` · ${tgStatus.detail}` : ""}</p>
            {isAdmin && <form action={disconnectTelegram}><input type="hidden" name="id" value={tgConn.id} /><button>Disconnect</button></form>}
          </>
        ) : isAdmin ? (
          <>
            <ol className="mut" style={{ paddingLeft: 18 }}>
              <li>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code> and copy the token it gives you.</li>
              <li>Send <code>/setprivacy</code> to BotFather, pick your bot, choose <b>Disable</b>. Otherwise the bot cannot see normal group messages.</li>
              <li>Paste the token below. It is stored encrypted and never shown again.</li>
              <li>Add the bot to each partner group. It only receives messages sent after it joins.</li>
            </ol>
            <form className="row" action={connectTelegram}><input name="token" type="password" placeholder="Bot token (123456:ABC…)" autoComplete="off" required style={{ flex: 1, minWidth: 240 }} /><button className="pri">Connect Telegram</button></form>
          </>
        ) : <p className="mut">Ask an admin to connect Telegram.</p>}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="between"><b>Email (any mailbox)</b><span className={`pill ${(boxes ?? []).length ? "ok" : ""}`}>{(boxes ?? []).length ? `${(boxes ?? []).length} connected` : "Not connected"}</span></div>
        <p className="mut">Connect Gmail, Outlook, Yahoo, iCloud or a company mailbox. Mail from partners appears in the Inbox as conversations and you reply from there. ARMPIT only reads the inbox: it never deletes, moves or marks your mail as read.</p>
        {(boxes ?? []).map((b: any) => (
          <div key={b.id} className="between" style={{ padding: "10px 0", borderTop: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
            <div><b>{b.external_account ?? "…"}</b> <span className={`pill ${b.status === "connected" ? "ok" : "warn"}`}>{b.status === "connected" ? "Working" : b.status === "error" ? "Sign-in failed" : b.status}</span>
              <div className="mut" style={{ fontSize: 13 }}>{b.member?.full_name ?? "—"} · last checked {b.last_polled_at ? ago(b.last_polled_at) : "never"}{b.last_error ? ` · ${b.last_error}` : ""}</div></div>
            <div className="row" style={{ margin: 0 }}>
              <form action={checkMail}><input type="hidden" name="id" value={b.id} /><button>Check now</button></form>
              {(isAdmin || b.member_id === member.id) && <form action={disconnectEmail}><input type="hidden" name="id" value={b.id} /><button>Disconnect</button></form>}
            </div></div>))}
        <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Connect a mailbox</summary>
          <form action={connectEmail} style={{ marginTop: 12 }}>
            <div className="formgrid">
              <label>Email address<input name="email" type="email" required placeholder="you@example.com" autoComplete="off" /></label>
              <label>Password or app password<input name="password" type="password" required autoComplete="new-password" /></label>
            </div>
            <ul className="mut" style={{ fontSize: 13, paddingLeft: 18 }}>{PRESETS.map((p) => <li key={p.id}><b>{p.label}:</b> {p.hint}</li>)}<li><b>Company mailboxes:</b> leave the advanced settings empty to try <code>imap.yourdomain</code> and <code>smtp.yourdomain</code>, or ask your IT team for the server names.</li></ul>
            <details><summary className="mut" style={{ cursor: "pointer" }}>Advanced server settings (optional)</summary>
              <div className="formgrid" style={{ marginTop: 10 }}>
                <label>Username (if not the address)<input name="username" autoComplete="off" /></label>
                <label>Incoming (IMAP) server<input name="imap_host" placeholder="imap.example.com" /></label><label>IMAP port<input name="imap_port" type="number" placeholder="993" /></label>
                <label>Outgoing (SMTP) server<input name="smtp_host" placeholder="smtp.example.com" /></label><label>SMTP port<input name="smtp_port" type="number" placeholder="465" /></label>
              </div></details>
            <button className="pri" style={{ marginTop: 12 }}>Connect mailbox</button>
          </form></details>
        <p className="mut" style={{ fontSize: 12, marginBottom: 0 }}>New mail is checked every 90 seconds while the Inbox is open, and once a day in the background.</p>
      </div>
      <p className="mut" style={{ fontSize: 13 }}>WhatsApp, Microsoft Teams and LinkedIn are not connected yet.</p>
      <h2>Diagnostics</h2>
      <div className="card between"><span className="mut">Checks the database setup, settings and integrations, and shows what has been proven to work.</span><Link href="/settings/diagnostics"><button>Open diagnostics</button></Link></div>
      <h2>Billing</h2><div className="card mut">TODO: Stripe Checkout and customer portal, driven by seats.</div>
      {isAdmin && <><h2>Audit log</h2><div className="card">{audit!.map((a: any) => <div key={a.id}>{a.action} <span className="mut">· {a.actor?.full_name ?? a.actor?.email ?? "System"}</span></div>)}{!audit!.length && <span className="mut">Nothing recorded yet.</span>}<p style={{ margin: "10px 0 0" }}><Link href="/settings/audit">View the full audit log →</Link></p></div></>}
    </>
  );
}
