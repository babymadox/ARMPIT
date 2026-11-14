import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { money, date } from "@/lib/format";

const FLOW = ["draft", "pending_approval", "approved", "live", "ended"];

async function advance(fd: FormData) {
  "use server";
  const { db, isAdmin } = await requireSession();
  const status = String(fd.get("status"));
  // Approving is an admin decision; members can only request it.
  if (["approved", "live"].includes(status) && !isAdmin) throw new Error("Only admins can approve deals");
  { const { error: werr } = await db.from("deals").update({ status }).eq("id", String(fd.get("id"))); if (werr) throw new Error(werr.message); }
  revalidatePath("/deals");
}

export default async function Deals() {
  const { db } = await requireSession();
  const { data: deals = [] } = await db.from("deals").select("id,brand,kind,amount,rev_share_pct,cap,progress,status,currency,geos,partner:partners(id,name)").order("created_at", { ascending: false });
  return (
    <>
      <h1>Deals</h1>
      <div className="card"><table>
        <thead><tr><th>Partner</th><th>Brand</th><th>Terms</th><th>Cap</th><th>Status</th><th /></tr></thead>
        <tbody>{deals!.map((d: any) => {
          const next = FLOW[FLOW.indexOf(d.status) + 1];
          return <tr key={d.id}><td><Link href={`/partners/${d.partner.id}`}>{d.partner.name}</Link></td><td>{d.brand}</td>
            <td>{d.kind} {d.amount ? money(d.amount, d.currency) : ""} {d.rev_share_pct ? `${d.rev_share_pct}% RS` : ""}</td>
            <td>{d.cap ? `${d.progress ?? 0}/${d.cap}` : "No cap"}</td><td><Chip v={d.status} /></td>
            <td>{next && <form action={advance}><input type="hidden" name="id" value={d.id} /><button name="status" value={next}>→ {next.replace("_", " ")}</button></form>}</td></tr>;
        })}</tbody></table></div>
    </>
  );
}
