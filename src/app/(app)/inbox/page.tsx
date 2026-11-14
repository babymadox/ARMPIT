import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { ago } from "@/lib/format";

async function reply(fd: FormData) {
  "use server";
  const { db, org } = await requireSession();
  const conversation_id = String(fd.get("c"));
  // Persist first; the outbound worker (see lib/integrations/channels) delivers it to the provider.
  await db.from("messages").insert({ org_id: org.id, conversation_id, direction: "out", sender_name: "You", body: String(fd.get("body")) });
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), unread: false }).eq("id", conversation_id);
  revalidatePath("/inbox");
}

export default async function Inbox({ searchParams }: { searchParams: Promise<{ c?: string; ch?: string }> }) {
  const { c, ch } = await searchParams;
  const { db } = await requireSession(); // RLS already limits this to my chats (or all, for admins)
  let q = db.from("conversations").select("id,channel,title,unread,last_message_at,partner:partners(name)").order("last_message_at", { ascending: false }).limit(100);
  if (ch) q = q.eq("channel", ch);
  const { data: chats = [] } = await q;
  const open = c ?? chats![0]?.id;
  const { data: msgs = [] } = open ? await db.from("messages").select("id,direction,sender_name,body,sent_at").eq("conversation_id", open).order("sent_at") : { data: [] };
  return (
    <>
      <h1>Inbox</h1>
      <div className="split">
        <div className="card">
          <form className="row">{["telegram", "whatsapp", "teams", "gmail"].map((k) => <button key={k} name="ch" value={k}>{k}</button>)}</form>
          {chats!.map((x: any) => (
            <Link key={x.id} href={`/inbox?c=${x.id}`} style={{ display: "block", padding: "8px 0", fontWeight: x.unread ? 700 : 400 }}>
              {x.partner?.name ?? x.title}<div className="mut" style={{ fontSize: 12 }}>{x.channel} · {ago(x.last_message_at)}</div>
            </Link>))}
          {!chats!.length && <p className="mut">No conversations yet. Connect a channel in Settings → Channels.</p>}
        </div>
        <div className="card">
          {msgs!.map((m: any) => <div key={m.id} className={`msg ${m.direction}`}>{m.body}</div>)}
          {open && <form className="row" action={reply}><input type="hidden" name="c" value={open} /><input name="body" style={{ flex: 1 }} placeholder="Write a reply" required /><button className="pri">Send</button></form>}
        </div>
      </div>
    </>
  );
}
