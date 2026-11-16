import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { Empty, PageHeader } from "@/components/ui";
import { money, date } from "@/lib/format";
import { parse, dealSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notify, notifyAdmins } from "@/lib/notify";
import { fetchAll } from "@/lib/db";

const FLOW = ["draft", "pending_approval", "approved", "live", "ended"];
const back = (msg: string) => redirect(`/deals?msg=${encodeURIComponent(msg)}`);

async function createDeal(fd: FormData) {
  "use server";
  const { db, org, member } = await requireSession();
  const r = parse(dealSchema, fd);
  if (!r.ok) return back(`Could not create the deal: ${r.error}`);
  const d = r.data;
  const { data: p } = await db.from("partners").select("id,name").eq("id", d.partner_id).maybeSingle();     // RLS: must be in my workspace
  if (!p) return back("Could not create the deal: partner not found");
  const status = d.submit ? "pending_approval" : "draft";
  const { data: row, error } = await db.from("deals").insert({
    org_id: org.id, partner_id: d.partner_id, direction: d.direction, brand: d.brand, kind: d.kind, amount: d.amount ?? null, rev_share_pct: d.rev_share_pct ?? null, cap: d.cap ?? null,
    currency: d.currency, geos: d.geos, metric: d.metric ?? null, promo_code: d.promo_code ?? null, landing_url: d.landing_url ?? null, starts_on: d.starts_on ?? null, ends_on: d.ends_on ?? null,
    status, owner_id: member.id, requested_by: member.id,
  }).select("id").single();
  if (error || !row) return back(`Could not create the deal: ${error?.message}`);
  await audit({ orgId: org.id, actorId: member.id, action: "deal.create", entity: "deal", entityId: row.id, meta: { partner: p.name, brand: d.brand, kind: d.kind, status } });
  if (status === "pending_approval") await notifyAdmins(org.id, { title: `Deal awaiting approval: ${d.brand}`, body: `${p.name} · ${d.kind.toUpperCase()}`, href: "/deals" }, member.id);
  revalidatePath("/deals");
  back(`Deal created as ${status.replace("_", " ")}`);
}

/** Moves a deal one step along draft → pending → approved → live → ended. Members can only submit for approval. */
async function advance(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  const id = String(fd.get("id")), to = String(fd.get("status"));
  const { data: deal } = await db.from("deals").select("id,brand,status,requested_by,partner:partners(name)").eq("id", id).maybeSingle();
  if (!deal) return back("Deal not found");
  const isNext = FLOW[FLOW.indexOf(deal.status) + 1] === to, isReject = deal.status === "pending_approval" && to === "draft";
  if (!isNext && !isReject) return back(`A deal cannot go from ${deal.status} to ${to}`);
  if (!isAdmin && to !== "pending_approval") return back("Only admins can approve, start or end a deal");
  if (isReject && !isAdmin) return back("Only admins can send a deal back");
  const { error } = await db.from("deals").update({ status: to }).eq("id", id);
  if (error) return back(`Could not update the deal: ${error.message}`);
  await audit({ orgId: org.id, actorId: member.id, action: `deal.${to}`, entity: "deal", entityId: id, meta: { brand: deal.brand, from: deal.status, to } });
  const partner = (deal.partner as any)?.name ?? "";
  if (to === "pending_approval") await notifyAdmins(org.id, { title: `Deal awaiting approval: ${deal.brand}`, body: partner, href: "/deals" }, member.id);
  else if (deal.requested_by && deal.requested_by !== member.id) await notify({ orgId: org.id, memberId: deal.requested_by, title: `Your deal is now ${to.replace("_", " ")}: ${deal.brand}`, body: partner, href: "/deals" });
  revalidatePath("/deals");
  back(`Deal moved to ${to.replace("_", " ")}`);
}

export default async function Deals({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { db, isAdmin } = await requireSession();
  const [{ data: deals = [], error }, partners] = await Promise.all([
    db.from("deals").select("id,brand,kind,amount,rev_share_pct,cap,progress,status,currency,geos,partner:partners(id,name),requester:members!requested_by(full_name)").order("created_at", { ascending: false }).limit(500),
    fetchAll<{ id: string; name: string }>((f, t) => db.from("partners").select("id,name").order("name").order("id").range(f, t)),
  ]);
  return (
    <>
      <PageHeader title="Deals" sub="Terms agreed with partners and advertisers" />
      {msg && <div className="notice" role="status">{msg}</div>}
      {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)" }}>{error.message}</div>}
      <details className="card" style={{ marginBottom: 16 }}>
        <summary>+ New deal</summary>
        <form action={createDeal}>
          <div className="formgrid">
            <label>Partner<select name="partner_id" required defaultValue=""><option value="" disabled>Choose…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Direction<select name="direction"><option value="out">We pay the partner</option><option value="in">Advertiser pays us</option></select></label>
            <label>Brand<input name="brand" required maxLength={80} placeholder="LuckySpin" /></label>
            <label>Deal type<select name="kind" defaultValue="cpa"><option value="cpa">CPA</option><option value="cpl">CPL</option><option value="revshare">Revenue share</option><option value="hybrid">Hybrid (CPA + RS)</option></select></label>
            <label>Amount (CPA / CPL / hybrid)<input name="amount" type="number" min="0" step="0.01" /></label>
            <label>Revenue share %<input name="rev_share_pct" type="number" min="0" max="100" step="0.1" /></label>
            <label>Cap (conversions)<input name="cap" type="number" min="1" step="1" /></label>
            <label>Currency<select name="currency"><option>USD</option><option>EUR</option><option>GBP</option></select></label>
            <label>GEOs (comma separated)<input name="geos" placeholder="UK, IE" /></label>
            <label>Metric<input name="metric" placeholder="QFTD" /></label>
            <label>Promo code<input name="promo_code" /></label>
            <label>Landing page<input name="landing_url" type="url" placeholder="https://…" /></label>
            <label>Starts<input name="starts_on" type="date" /></label>
            <label>Ends<input name="ends_on" type="date" /></label>
          </div>
          <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="submit" style={{ padding: 0, width: "auto" }} /> Submit for approval now</label>
            <button className="pri">Create deal</button>
          </div>
        </form>
      </details>
      {!(deals ?? []).length ? <Empty icon="deals" title="No deals yet">Create the first one above.</Empty> : (
        <div className="card scroll"><table>
          <thead><tr><th>Partner</th><th>Brand</th><th>Terms</th><th>Cap</th><th>Status</th><th /></tr></thead>
          <tbody>{(deals ?? []).map((d: any) => {
            const next = FLOW[FLOW.indexOf(d.status) + 1], canStep = next && (isAdmin || next === "pending_approval");
            return <tr key={d.id}><td><Link href={`/partners/${d.partner.id}`}>{d.partner.name}</Link><div className="mut" style={{ fontSize: 12 }}>by {d.requester?.full_name ?? "—"}</div></td><td>{d.brand}</td>
              <td>{d.kind.toUpperCase()} {d.amount != null ? money(d.amount, d.currency) : ""} {d.rev_share_pct != null ? `${d.rev_share_pct}% RS` : ""}</td>
              <td>{d.cap ? `${d.progress ?? 0}/${d.cap}` : "No cap"}</td><td><Chip v={d.status} /></td>
              <td><div className="row" style={{ margin: 0, flexWrap: "nowrap" }}>
                {canStep && <form action={advance}><input type="hidden" name="id" value={d.id} /><button name="status" value={next} className={next === "approved" ? "pri" : ""}>→ {next.replace("_", " ")}</button></form>}
                {isAdmin && d.status === "pending_approval" && <form action={advance}><input type="hidden" name="id" value={d.id} /><button name="status" value="draft">Send back</button></form>}
              </div></td></tr>;
          })}</tbody></table></div>)}
    </>
  );
}
