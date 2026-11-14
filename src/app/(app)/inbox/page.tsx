import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { ago } from "@/lib/format";
import { Avatar, Icon, PageHeader } from "@/components/ui";

const CHANNELS = [
  { k: "telegram", n: "Telegram", c: "#229ed9" }, { k: "whatsapp", n: "WhatsApp", c: "#25d366" }, { k: "teams", n: "Microsoft Teams", c: "#5b5fc7" },
  { k: "gmail", n: "Gmail", c: "#ea4335" }, { k: "linkedin", n: "LinkedIn", c: "#0a66c2" },
];

async function reply(fd: FormData) {
  "use server";
  const { db, org } = await requireSession();
  const conversation_id = String(fd.get("c"));
  // Persisted only: delivery to the provider needs the channel adapter (not connected yet).
  await db.from("messages").insert({ org_id: org.id, conversation_id, direction: "out", sender_name: "You", body: String(fd.get("body")) });
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), unread: false }).eq("id", conversation_id);
  revalidatePath("/inbox");
}

export default async function Inbox({ searchParams }: { searchParams: Promise<{ c?: string; ch?: string }> }) {
  const { c, ch } = await searchParams;
  const { db } = await requireSession(); // RLS already limits this to my chats (or all, for admins)
  let q = db.from("conversations").select("id,channel,title,unread,last_message_at,partner:partners(name)").order("last_message_at", { ascending: false }).limit(100);
  if (ch) q = q.eq("channel", ch);
  const [{ data: chats = [] }, { data: conns = [] }] = await Promise.all([q, db.from("channel_connections").select("kind,status")]);
  const connected = new Set((conns ?? []).filter((x: any) => x.status === "connected").map((x: any) => x.kind));
  const open = c ?? chats![0]?.id;
  const { data: msgs = [] } = open ? await db.from("messages").select("id,direction,sender_name,body,sent_at").eq("conversation_id", open).order("sent_at") : { data: [] };

  return (
    <>
      <PageHeader title="Inbox" sub="Every partner conversation, from every channel" />
      <div className="channels" style={{ marginBottom: 22 }}>
        {CHANNELS.map((x) => (
          <div className="card channel" key={x.k}>
            <div className="top"><span className="ch-ic" style={{ background: x.c }}>{x.n[0]}</span><div><b>{x.n}</b><div className="mut" style={{ fontSize: 13 }}>{connected.has(x.k as any) ? "Connected" : "Not connected"}</div></div></div>
            {connected.has(x.k as any)
              ? <Link href={`/inbox?ch=${x.k}`}><button style={{ width: "100%" }}>Open {x.n}</button></Link>
              : <><span className="pill warn" style={{ alignSelf: "flex-start" }}>API setup required</span><button disabled title="This channel's API connection has not been set up yet" style={{ opacity: 0.55, cursor: "not-allowed" }}>Connect</button></>}
          </div>))}
      </div>
      {!chats!.length ? (
        <div className="empty"><span className="stat-ic brand"><Icon name="chat" size={22} /></span><b>No conversations yet</b>
          <p>Messages appear here once a channel above is connected. Each channel needs its API set up before it can fetch messages.</p></div>
      ) : (
        <div className="split">
          <div className="card">
            <div className="toolbar" style={{ marginBottom: 8 }}>{CHANNELS.map((k) => <Link key={k.k} className={`pill${ch === k.k ? " ok" : ""}`} href={`/inbox?ch=${k.k}`}>{k.n}</Link>)}{ch && <Link className="pill" href="/inbox">All</Link>}</div>
            {chats!.map((x: any) => (
              <Link key={x.id} href={`/inbox?c=${x.id}`} className={`convo${x.unread ? " unread" : ""}`}>
                <Avatar name={x.partner?.name ?? x.title ?? "?"} /><div><b>{x.partner?.name ?? x.title}</b><div className="mut" style={{ fontSize: 12 }}>{x.channel} · {ago(x.last_message_at)}</div></div>
              </Link>))}
          </div>
          <div className="card thread">
            {msgs!.map((m: any) => <div key={m.id} className={`msg ${m.direction}`}>{m.body}</div>)}
            {open && <form className="row" action={reply} style={{ marginTop: "auto" }}><input type="hidden" name="c" value={open} /><input name="body" style={{ flex: 1 }} placeholder="Write a reply" required /><button className="pri">Send</button></form>}
          </div>
        </div>
      )}
    </>
  );
}
