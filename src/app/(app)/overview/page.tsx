import { revalidatePath } from "next/cache";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { date } from "@/lib/format";

async function setTask(fd: FormData) {
  "use server";
  const { db } = await requireSession();
  await db.from("tasks").update({ status: String(fd.get("status")) }).eq("id", String(fd.get("id")));
  revalidatePath("/overview");
}
async function addTask(fd: FormData) {
  "use server";
  const { db, org, member } = await requireSession();
  await db.from("tasks").insert({ org_id: org.id, title: String(fd.get("title")), assignee_id: member.id, due_on: String(fd.get("due") || "") || null });
  revalidatePath("/overview");
}

export default async function Overview() {
  const { db, member } = await requireSession();
  const today = new Date().toISOString().slice(0, 10);
  const [tasks, unread, payBlocked, liveDeals] = await Promise.all([
    db.from("tasks").select("id,title,status,priority,due_on,partner:partners(id,name)").neq("status", "done").eq("assignee_id", member.id).order("due_on"),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("unread", true),
    db.from("payments").select("id", { count: "exact", head: true }).in("status", ["difference", "disputed", "overdue"]),
    db.from("deals").select("id", { count: "exact", head: true }).eq("status", "live"),
  ]);
  return (
    <>
      <h1>Overview</h1>
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card stat"><span className="mut">Unread chats</span><b>{unread.count ?? 0}</b></div>
        <div className="card stat"><span className="mut">Payments needing attention</span><b>{payBlocked.count ?? 0}</b></div>
        <div className="card stat"><span className="mut">Live deals</span><b>{liveDeals.count ?? 0}</b></div>
      </div>
      <h2>My tasks</h2>
      <form className="row" action={addTask}><input name="title" placeholder="New task" required style={{ flex: 1 }} /><input type="date" name="due" /><button className="pri">Add</button></form>
      <div className="card"><table><tbody>{(tasks.data ?? []).map((t: any) => (
        <tr key={t.id}><td>{t.title}<div className="mut">{t.partner && <Link href={`/partners/${t.partner.id}`}>{t.partner.name}</Link>}</div></td>
          <td style={{ color: t.due_on && t.due_on < today ? "var(--bad)" : undefined }}>{date(t.due_on)}</td><td><Chip v={t.status} /></td>
          <td><form action={setTask}><input type="hidden" name="id" value={t.id} /><button name="status" value="done">Done</button></form></td></tr>))}</tbody></table></div>
    </>
  );
}
