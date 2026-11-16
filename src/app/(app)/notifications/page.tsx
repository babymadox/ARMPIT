import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Empty, Icon, PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";

const safe = (h: string | null) => (h && h.startsWith("/") && !h.startsWith("//") ? h : "/notifications");   // internal links only

async function open(fd: FormData) {
  "use server";
  const { db } = await requireSession();
  const id = String(fd.get("id"));
  const { data: n } = await db.from("notifications").select("href").eq("id", id).maybeSingle();   // RLS: only my own
  if (!n) return;
  const { error } = await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
  redirect(safe(n.href));
}
async function markAll() {
  "use server";
  const { db } = await requireSession();
  const { error } = await db.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

export default async function Notifications() {
  const { db } = await requireSession();
  const { data, error } = await db.from("notifications").select("id,title,body,href,read_at,created_at").order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [], unread = rows.filter((r) => !r.read_at).length;
  return (
    <>
      <PageHeader title="Notifications" sub={unread ? `${unread} unread` : "You are all caught up"} actions={unread ? <form action={markAll}><button>Mark all as read</button></form> : undefined} />
      {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)" }}><b>Could not load notifications.</b> {error.message}. This usually means migration 10 has not been applied.</div>}
      {!rows.length ? <Empty icon="notifications" title="No notifications yet">New partner messages, deals awaiting approval and automation alerts appear here.</Empty> : (
        <div className="card" style={{ padding: 6 }}>{rows.map((n) => (
          <form action={open} key={n.id}><input type="hidden" name="id" value={n.id} />
            <button className={`notif${n.read_at ? "" : " unread"}`}><span className="dot" aria-hidden /><span className="grow"><b>{n.title}</b>{n.body && <span className="mut"> · {n.body}</span>}</span><span className="mut">{ago(n.created_at)}</span><Icon name="check" size={14} /></button></form>))}</div>)}
    </>
  );
}
