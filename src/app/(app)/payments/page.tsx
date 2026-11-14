import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { money, date } from "@/lib/format";

const FLOW = ["waiting_for_data", "ready", "invoiced", "approved", "paid", "confirmed"];

async function setStatus(fd: FormData) {
  "use server";
  const { db } = await requireSession();
  { const { error: werr } = await db.from("payments").update({ status: String(fd.get("status")) }).eq("id", String(fd.get("id"))); if (werr) throw new Error(werr.message); }
  revalidatePath("/payments");
}

export default async function Payments({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  const { db } = await requireSession();
  let q = db.from("payments").select("id,period,direction,currency,expected,tracker_amount,invoiced_amount,status,blocker,due_on,partner:partners(id,name)").order("due_on");
  if (s) q = q.eq("status", s);
  const { data: rows = [] } = await q;
  return (
    <>
      <h1>Payments</h1>
      <form className="row">{["difference", "disputed", "overdue", "waiting_for_invoice", "paid"].map((x) => <button key={x} name="s" value={x}>{x.replace(/_/g, " ")}</button>)}<button>All</button></form>
      <div className="card"><table>
        <thead><tr><th>Partner</th><th>Period</th><th>Expected</th><th>Tracker</th><th>Gap</th><th>Status</th><th>Due</th><th /></tr></thead>
        <tbody>{rows!.map((p: any) => {
          // "Difference" is surfaced from data, never trusted from the stored status alone.
          const gap = p.tracker_amount == null ? null : Number(p.expected) - Number(p.tracker_amount);
          const next = FLOW[FLOW.indexOf(p.status) + 1];
          return <tr key={p.id}><td><Link href={`/partners/${p.partner.id}`}>{p.partner.name}</Link><div className="mut">{p.blocker}</div></td>
            <td>{date(p.period)}</td><td>{money(p.expected, p.currency)}</td><td>{money(p.tracker_amount, p.currency)}</td>
            <td style={{ color: gap ? "var(--bad)" : undefined }}>{gap ? money(gap, p.currency) : "—"}</td><td><Chip v={p.status} /></td><td>{date(p.due_on)}</td>
            <td>{next && <form action={setStatus}><input type="hidden" name="id" value={p.id} /><button name="status" value={next}>→ {next.replace(/_/g, " ")}</button></form>}</td></tr>;
        })}</tbody></table></div>
    </>
  );
}
