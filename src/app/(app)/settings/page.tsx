import { requireSession } from "@/lib/session";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Chip } from "@/components/Chip";
import { trackers as adapters, channels } from "@/lib/integrations";
import { readCreds, storeCreds } from "@/lib/secrets";
import { siteOrigin, webhookUrl } from "@/lib/site";
import { PageHeader } from "@/components/ui";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function connectTracker(fd: FormData) {
  "use server";
  const { org, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const kind = String(fd.get("kind")) as keyof typeof adapters;
  const creds = { api_key: String(fd.get("api_key")) };
  const test = await adapters[kind].test(creds);                 // never save a key that does not work
  if (!test.ok) throw new Error(`Could not connect: ${test.error}`);
  const secret = await storeCreds(`${org.id}:${kind}`, creds);
  await supabaseAdmin().from("tracker_connections").insert({ org_id: org.id, kind, label: String(fd.get("label") || kind), vault_secret_id: secret });
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
    await supabaseAdmin().from("channel_connections").update({ vault_secret_id: secret, external_account: account, status: "connected" }).eq("id", row.id);
  } catch (e) {
    await db.from("channel_connections").delete().eq("id", row.id);          // no half-connected state
    return back(`Could not connect: ${e instanceof Error ? e.message : e}`);
  }
  revalidatePath("/settings"); revalidatePath("/inbox");
  back("Telegram connected. Now add the bot to a partner group and send a message.");
}

async function disconnectTelegram(fd: FormData) {
  "use server";
  const { db, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const id = String(fd.get("id"));
  const { data: c } = await db.from("channel_connections").select("id,vault_secret_id").eq("id", id).maybeSingle();
  if (c) { try { await channels.telegram.disconnect(await readCreds(c.vault_secret_id)); } catch { /* best effort */ } await db.from("channel_connections").delete().eq("id", id); }
  revalidatePath("/settings"); revalidatePath("/inbox");
  back("Telegram disconnected. Existing conversations are kept.");
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { db, org, isAdmin } = await requireSession();
  const [{ data: trackers = [] }, { data: audit = [] }, { data: tg = [] }] = await Promise.all([
    db.from("tracker_connections").select("id,kind,label,status,last_synced_at"),
    isAdmin ? db.from("audit_log").select("id,action,entity,created_at").order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    db.from("channel_connections").select("id,external_account,status,vault_secret_id").eq("kind", "telegram"),
  ]);
  const tgConn: any = tg![0];
  let tgStatus: { ok: boolean; detail: string } | null = null;
  if (tgConn && isAdmin) {   // live health check against Telegram, so a broken webhook is visible instead of silent
    try { tgStatus = await channels.telegram.status(await readCreds(tgConn.vault_secret_id), webhookUrl(await siteOrigin(), "telegram", tgConn.id)); }
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
      <p className="mut" style={{ fontSize: 13 }}>WhatsApp, Microsoft Teams, Gmail and LinkedIn are not connected yet.</p>
      <h2>Billing</h2><div className="card mut">TODO: Stripe Checkout and customer portal, driven by seats.</div>
      {isAdmin && <><h2>Audit log</h2><div className="card">{audit!.map((a: any) => <div key={a.id}>{a.action} <span className="mut">{a.entity}</span></div>)}</div></>}
    </>
  );
}
