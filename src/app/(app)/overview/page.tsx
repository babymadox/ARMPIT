import { revalidatePath } from "next/cache";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { date } from "@/lib/format";
import { PageHeader, Stat, Empty } from "@/components/ui";

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
      <PageHeader title="Overview" sub="What needs your attention today" />
      <div className="grid">
        <Stat label="Unread chats" value={unread.count ?? 0} icon="chat" href="/inbox" />
        <Stat label="Payments needing attention" value={payBlocked.count ?? 0} icon="alert" tone={(payBlocked.count ?? 0) > 0 ? "warn" : "ok"} href="/payments" />
        <Stat label="Live deals" value={liveDeals.count ?? 0} icon="deals" tone="ok" href="/deals" />
      </div>
      <h2>My tasks</h2>
      <form className="row" action={addTask}><input name="title" placeholder="New task" required style={{ flex: 1 }} /><input type="date" name="due" /><button className="pri">Add</button></form>
      {!(tasks.data ?? []).length ? <Empty icon="check" title="You are all caught up">No open tasks assigned to you. Add one above.</Empty> : <div className="card"><table><tbody>{(tasks.data ?? []).map((t: any) => (
        <tr key={t.id}><td>{t.title}<div className="mut">{t.partner && <Link href={`/partners/${t.partner.id}`}>{t.partner.name}</Link>}</div></td>
          <td style={{ color: t.due_on && t.due_on < today ? "var(--bad)" : undefined }}>{date(t.due_on)}</td><td><Chip v={t.status} /></td>
          <td><form action={setTask}><input type="hidden" name="id" value={t.id} /><button name="status" value="done">Done</button></form></td></tr>))}</tbody></table></div>}
    </>
  );
}
