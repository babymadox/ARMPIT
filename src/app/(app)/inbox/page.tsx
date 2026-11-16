import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { channels } from "@/lib/integrations";
import { readCreds } from "@/lib/secrets";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ago } from "@/lib/format";
import { Avatar, Icon, PageHeader } from "@/components/ui";
import { LiveRefresh } from "@/components/LiveRefresh";
import { MessageList } from "@/components/MessageList";
import { errMsg, logEvent } from "@/lib/log";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

export const maxDuration = 30;

const CHANNELS = [
  { k: "telegram", n: "Telegram", c: "#229ed9", live: true }, { k: "whatsapp", n: "WhatsApp", c: "#25d366" }, { k: "teams", n: "Microsoft Teams", c: "#5b5fc7" },
  { k: "gmail", n: "Gmail", c: "#ea4335" }, { k: "linkedin", n: "LinkedIn", c: "#0a66c2" },
];

/** Saves the reply, then delivers it through the channel. A failed delivery stays visible on the message. */
async function reply(fd: FormData) {
  "use server";
  const { db, org } = await requireSession();
  const cid = String(fd.get("c")), body = String(fd.get("body") ?? "").trim();
  if (!body) return;
  const { data: conv } = await db.from("conversations").select("id,channel,external_id,connection_id").eq("id", cid).maybeSingle();   // RLS: only chats I can see
  if (!conv) throw new Error("Conversation not found");
  const { data: msg, error } = await db.from("messages").insert({ org_id: org.id, conversation_id: cid, direction: "out", sender_name: "You", body, delivery_status: "pending" }).select("id").single();
  if (error || !msg) throw new Error(error?.message ?? "Could not save the message");
  const admin = supabaseAdmin();
  const fail = async (e: unknown) => { await logEvent({ orgId: org.id, level: "warn", source: "inbox.reply", message: `delivery failed: ${errMsg(e)}`, details: { channel: conv.channel } }); await admin.from("messages").update({ delivery_status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", msg.id); /* best effort: the user sees the failure either way */ };

  // 1) Deliver. Only a failure HERE means "not delivered".
  let externalId: string;
  try {
    if (!conv.connection_id) throw new Error("This chat has no channel connection");
    const { data: conn } = await admin.from("channel_connections").select("vault_secret_id,org_id").eq("id", conv.connection_id).eq("org_id", org.id).single();
    if (!conn) throw new Error("Channel connection not found");
    const adapter = (channels as Record<string, (typeof channels)[keyof typeof channels]>)[conv.channel];
    externalId = (await adapter.send(await readCreds(conn.vault_secret_id, org.id), conv.external_id, body)).externalId;
  } catch (e) { await fail(e); revalidatePath("/inbox"); return; }

  // 2) Record it. The partner already has the message, so a failed update must never mark it "failed"
  //    (that invites a resend and a duplicate). Retry once; otherwise leave it pending and log.
  for (let i = 0; i < 2; i++) {
    const { error: upErr } = await admin.from("messages").update({ delivery_status: "sent", external_id: externalId }).eq("id", msg.id);
    if (!upErr) break;
    if (i === 1) await logEvent({ orgId: org.id, level: "error", source: "inbox.reply", message: `delivered but status update failed: ${errMsg(upErr.message)}`, details: { channel: conv.channel } });
  }
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), last_direction: "out", unread: false }).eq("id", cid); // best effort: ordering hint only
  revalidatePath("/inbox");
}

async function setPartner(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const pid = String(fd.get("partner") ?? "");
  if (pid) { const { data: p } = await db.from("partners").select("id").eq("id", pid).maybeSingle(); if (!p) throw new Error("Partner not found"); }   // RLS: must be in my workspace
  const { error } = await db.from("conversations").update({ partner_id: pid || null }).eq("id", String(fd.get("c")));
  if (error) throw new Error(error.message);
  await audit({ orgId: org.id, actorId: member.id, action: "chat.link_partner", entity: "conversation", entityId: String(fd.get("c")), meta: { partner: pid || null } });
  revalidatePath("/inbox");
}
async function setOwner(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const owner = String(fd.get("owner") ?? "");
  const { data: m } = await db.from("members").select("id").eq("id", owner).eq("status", "active").maybeSingle();   // RLS: must be in my workspace
  if (!m) throw new Error("Member not found");
  const { error } = await db.from("conversations").update({ owner_id: owner }).eq("id", String(fd.get("c")));
  if (error) throw new Error(error.message);
  await audit({ orgId: org.id, actorId: member.id, action: "chat.assign", entity: "conversation", entityId: String(fd.get("c")), meta: { owner } });
  if (owner !== member.id) await notify({ orgId: org.id, memberId: owner, title: "A chat was assigned to you", href: `/inbox?c=${String(fd.get("c"))}` });
  revalidatePath("/inbox");
}

export default async function Inbox({ searchParams }: { searchParams: Promise<{ c?: string; ch?: string }> }) {
  const { c, ch } = await searchParams;
  const { db, isAdmin } = await requireSession(); // RLS already limits this to my chats (or all, for admins)
  let q = db.from("conversations").select("id,channel,title,unread,last_message_at,partner_id,owner_id,partner:partners(name)").order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
  if (ch) q = q.eq("channel", ch);
  const [chatsRes, connsRes] = await Promise.all([q, db.from("channel_connections").select("kind,status")]);
  const chats = chatsRes.data ?? [], conns = connsRes.data ?? [];   // a failed query gives data: null, which a "= []" default would NOT replace
  const connected = new Set(conns.filter((x: any) => x.status === "connected").map((x: any) => x.kind));
  const open = c ?? chats[0]?.id;
  const current: any = chats.find((x: any) => x.id === open);
  // newest 300, shown oldest-first: a plain ascending select returns the OLDEST 1000 and hides recent messages in long chats
  const msgsRes = open ? await db.from("messages").select("id,direction,sender_name,body,sent_at,delivery_status,error").eq("conversation_id", open).order("sent_at", { ascending: false }).limit(300) : { data: [], error: null };
  const msgs = [...(msgsRes.data ?? [])].reverse();
  const loadError = chatsRes.error ?? connsRes.error ?? msgsRes.error;
  if (current?.unread) await db.from("conversations").update({ unread: false }).eq("id", open); // best effort: read marker
  const [{ data: partners = [] }, { data: members = [] }] = isAdmin && current
    ? await Promise.all([db.from("partners").select("id,name").order("name"), db.from("members").select("id,full_name,email").eq("status", "active")])
    : [{ data: [] }, { data: [] }];

  return (
    <div className="inbox">
      <LiveRefresh />
      <PageHeader title="Inbox" sub="Every partner conversation, from every channel" />
      {loadError && <div className="notice" role="alert" style={{ borderColor: "var(--bad)" }}><b>Part of the inbox could not load.</b> {loadError.message}. This usually means a database update is pending: run <code>supabase/catch-up.sql</code> (or migration 7) in the Supabase SQL editor.</div>}
      {chats.length ? (
        <div className="channel-strip" aria-label="Channels">{CHANNELS.map((x) => <span key={x.k} className={`pill${connected.has(x.k as any) ? " ok" : ""}`} title={connected.has(x.k as any) ? "Connected" : x.live ? "Not connected: connect it in Settings → Channels" : "API setup required"}>{x.n}{connected.has(x.k as any) ? " ✓" : ""}</span>)}<Link className="pill" href="/settings#channels">Manage channels</Link></div>
      ) : (
      <div className="channels" style={{ marginBottom: 22 }}>
        {CHANNELS.map((x) => (
          <div className="card channel" key={x.k}>
            <div className="top"><span className="ch-ic" style={{ background: x.c }}>{x.n[0]}</span><div><b>{x.n}</b><div className="mut" style={{ fontSize: 13 }}>{connected.has(x.k as any) ? "Connected" : "Not connected"}</div></div></div>
            {connected.has(x.k as any)
              ? <Link href={`/inbox?ch=${x.k}`}><button style={{ width: "100%" }}>Open {x.n}</button></Link>
              : x.live
                ? <Link href="/settings#channels"><button className="pri" style={{ width: "100%" }}>Connect</button></Link>
                : <><span className="pill warn" style={{ alignSelf: "flex-start" }}>API setup required</span><button disabled title="This channel's API connection has not been set up yet" style={{ opacity: 0.55, cursor: "not-allowed" }}>Connect</button></>}
          </div>))}
      </div>
      )}
      {!chats.length ? (
        <div className="empty"><span className="stat-ic brand"><Icon name="chat" size={22} /></span><b>No conversations yet</b>
          <p>{connected.size ? "New messages appear here as they arrive. Add the bot to a partner group and send a message." : "Connect a channel above. Messages appear here once it is connected."}</p></div>
      ) : (
        <div className={`split ${c ? "mobile-thread" : "mobile-list"}`}>
          <div className="card">
            <div className="toolbar" style={{ marginBottom: 8 }}>{CHANNELS.map((k) => <Link key={k.k} className={`pill${ch === k.k ? " ok" : ""}`} href={`/inbox?ch=${k.k}`}>{k.n}</Link>)}{ch && <Link className="pill" href="/inbox">All</Link>}</div>
            <div className="convlist">{chats.map((x: any) => (
              <Link key={x.id} href={`/inbox?c=${x.id}${ch ? `&ch=${ch}` : ""}`} className={`convo${x.unread && x.id !== open ? " unread" : ""}`}>
                <Avatar name={x.partner?.name ?? x.title ?? "?"} /><div><b>{x.partner?.name ?? x.title}</b><div className="mut" style={{ fontSize: 12 }}>{x.channel} · {ago(x.last_message_at)}</div></div>
              </Link>))}</div>
          </div>
          <div className="card thread">
            {current && (
              <div className="between thread-head" style={{ flexWrap: "wrap" }}>
                <div><Link className="back-chats" href={ch ? `/inbox?ch=${ch}` : "/inbox"}>← Chats</Link><div><b>{current.title ?? current.partner?.name}</b><div className="mut" style={{ fontSize: 13 }}>{current.channel}{current.partner ? ` · partner: ${current.partner.name}` : ""}</div></div></div>
                {isAdmin && (
                  <div className="row" style={{ margin: 0 }}>
                    <form action={setPartner} className="row" style={{ margin: 0 }}><input type="hidden" name="c" value={current.id} />
                      <select name="partner" defaultValue={current.partner_id ?? ""} aria-label="Partner"><option value="">No partner</option>{(partners ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button>Link</button></form>
                    <form action={setOwner} className="row" style={{ margin: 0 }}><input type="hidden" name="c" value={current.id} />
                      <select name="owner" defaultValue={current.owner_id ?? ""} aria-label="Assigned to">{(members ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}</select><button>Assign</button></form>
                  </div>)}
              </div>)}
            <MessageList conversationId={open ?? ""} lastId={msgs.length ? String(msgs[msgs.length - 1].id) : ""}>
            {msgs.map((m: any) => (
              <div key={m.id} className={`msg ${m.direction}`}>
                {m.direction === "in" && m.sender_name && <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7 }}>{m.sender_name}</div>}
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                {m.direction === "out" && m.delivery_status !== "sent" && <div style={{ fontSize: 12, marginTop: 4 }}>{m.delivery_status === "pending" ? "Sending…" : `⚠ Not delivered: ${m.error ?? "unknown error"}`}</div>}
              </div>))}
            </MessageList>
            {open && <form className="row composer" action={reply}><input type="hidden" name="c" value={open} /><input name="body" style={{ flex: 1 }} placeholder="Write a reply" maxLength={4000} required /><button className="pri">Send</button></form>}
          </div>
        </div>
      )}
    </div>
  );
}
