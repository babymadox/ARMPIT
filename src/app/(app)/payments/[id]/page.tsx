import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { Empty, PageHeader } from "@/components/ui";
import { money, date, ago } from "@/lib/format";
import { parse, adjustmentSchema, invoiceSchema, decisionSchema } from "@/lib/validation";
import { summarise, decide } from "@/lib/payments";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

const FLOW = ["waiting_for_data", "ready", "invoiced", "approved", "paid", "confirmed"];
const back = (id: string, msg: string) => redirect(`/payments/${id}?msg=${encodeURIComponent(msg)}`);

/** Loads the payment through RLS and checks the caller may change it: its owner, or an admin. */
async function guard(id: string, needAdmin = false) {
  const s = await requireSession();
  const { data: pay } = await s.db.from("payments").select("id,partner_id,owner_id,expected,tracker_amount,invoiced_amount,status,currency,period,partner:partners(name)").eq("id", id).maybeSingle();
  if (!pay) throw new Error("Payment not found");
  if (needAdmin && !s.isAdmin) throw new Error("Only admins can do this");
  if (!s.isAdmin && pay.owner_id !== s.member.id) throw new Error("Only the owner or an admin can change this payment");
  const { data: adj } = await s.db.from("payment_adjustments").select("amount").eq("payment_id", id);
  return { ...s, pay, sum: summarise({ expected: Number(pay.expected), tracker_amount: pay.tracker_amount == null ? null : Number(pay.tracker_amount), invoiced_amount: pay.invoiced_amount == null ? null : Number(pay.invoiced_amount) }, adj ?? []) };
}
const timeline = async (db: any, orgId: string, partnerId: string, authorId: string, body: string) => { await db.from("partner_notes").insert({ org_id: orgId, partner_id: partnerId, kind: "payment", body, author_id: authorId }); /* best effort: the audit log is the record */ };

async function addAdjustment(fd: FormData) {
  "use server";
  const id = String(fd.get("id")); const { db, org, member, pay } = await guard(id);
  const r = parse(adjustmentSchema, fd); if (!r.ok) return back(id, `Could not add the adjustment: ${r.error}`);
  const { error } = await db.from("payment_adjustments").insert({ org_id: org.id, payment_id: id, amount: r.data.amount, reason: r.data.reason, created_by: member.id });
  if (error) return back(id, `Could not add the adjustment: ${error.message}`);
  await timeline(db, org.id, pay.partner_id, member.id, `Payment adjustment ${money(r.data.amount, pay.currency)}: ${r.data.reason}`);
  await audit({ orgId: org.id, actorId: member.id, action: "payment.adjust", entity: "payment", entityId: id, meta: { amount: r.data.amount, reason: r.data.reason } });
  revalidatePath(`/payments/${id}`); back(id, "Adjustment added");
}
async function recordInvoice(fd: FormData) {
  "use server";
  const id = String(fd.get("id")); const { db, org, member, pay } = await guard(id);
  const r = parse(invoiceSchema, fd); if (!r.ok) return back(id, `Could not record the invoice: ${r.error}`);
  const toInvoiced = ["waiting_for_data", "ready", "waiting_for_invoice"].includes(pay.status);
  const { error } = await db.from("payments").update({ invoiced_amount: r.data.invoiced_amount, invoice_number: r.data.invoice_number, ...(toInvoiced ? { status: "invoiced" } : {}) }).eq("id", id);
  if (error) return back(id, `Could not record the invoice: ${error.message}`);
  await timeline(db, org.id, pay.partner_id, member.id, `Invoice ${r.data.invoice_number} recorded for ${money(r.data.invoiced_amount, pay.currency)}`);
  await audit({ orgId: org.id, actorId: member.id, action: "payment.invoice", entity: "payment", entityId: id, meta: { invoice: r.data.invoice_number, amount: r.data.invoiced_amount } });
  revalidatePath(`/payments/${id}`); back(id, "Invoice recorded");
}
async function recordDecision(fd: FormData) {
  "use server";
  const id = String(fd.get("id")); const { db, org, member, pay, sum } = await guard(id, true);
  const r = parse(decisionSchema, fd); if (!r.ok) return back(id, `Could not record the decision: ${r.error}`);
  const d = decide(r.data.decision, { adjusted: sum.adjusted, tracker: pay.tracker_amount == null ? null : Number(pay.tracker_amount) }, r.data.custom_amount, r.data.reason);
  if (!d.ok) return back(id, d.error);
  const { error } = await db.from("payments").update({ agreed_amount: d.amount, decision: d.note, decided_by: member.id, decided_at: new Date().toISOString(), status: "approved" }).eq("id", id);
  if (error) return back(id, `Could not record the decision: ${error.message}`);
  await timeline(db, org.id, pay.partner_id, member.id, `Decision: ${d.note} (${money(d.amount, pay.currency)})`);
  await audit({ orgId: org.id, actorId: member.id, action: "payment.decision", entity: "payment", entityId: id, meta: { amount: d.amount, decision: r.data.decision, expected: sum.adjusted, tracker: pay.tracker_amount } });
  if (pay.owner_id && pay.owner_id !== member.id) await notify({ orgId: org.id, memberId: pay.owner_id, title: `Payment decision: ${(pay.partner as any)?.name ?? "partner"}`, body: `${money(d.amount, pay.currency)} approved`, href: `/payments/${id}` });
  revalidatePath(`/payments/${id}`); back(id, `Decision recorded: pay ${money(d.amount, pay.currency)}`);
}
async function step(fd: FormData) {
  "use server";
  const id = String(fd.get("id")), to = String(fd.get("status")); const { db, org, member, pay } = await guard(id);
  if (FLOW[FLOW.indexOf(pay.status) + 1] !== to) return back(id, `A payment cannot go from ${pay.status} to ${to}`);
  if (["approved", "paid", "confirmed"].includes(to) && !(await requireSession()).isAdmin) return back(id, "Only admins can approve or mark a payment paid");
  const { error } = await db.from("payments").update({ status: to }).eq("id", id);
  if (error) return back(id, error.message);
  await audit({ orgId: org.id, actorId: member.id, action: `payment.${to}`, entity: "payment", entityId: id, meta: { from: pay.status } });
  revalidatePath(`/payments/${id}`); back(id, `Marked ${to.replace(/_/g, " ")}`);
}

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params, { msg } = await searchParams;
  const { db, isAdmin, member } = await requireSession();
  const { data: p } = await db.from("payments").select("*, partner:partners(id,name), owner:members!owner_id(full_name), decider:members!decided_by(full_name)").eq("id", id).maybeSingle();
  if (!p) notFound();
  const { data: adj = [] } = await db.from("payment_adjustments").select("id,amount,reason,created_at,author:members!created_by(full_name)").eq("payment_id", id).order("created_at", { ascending: false });
  const sum = summarise({ expected: Number(p.expected), tracker_amount: p.tracker_amount == null ? null : Number(p.tracker_amount), invoiced_amount: p.invoiced_amount == null ? null : Number(p.invoiced_amount) }, adj ?? []);
  const cur = p.currency, can = isAdmin || p.owner_id === member.id, next = FLOW[FLOW.indexOf(p.status) + 1];
  return (
    <>
      <p className="mut"><Link href="/payments">← Payments</Link></p>
      <PageHeader title={`${p.partner.name} · ${date(p.period)}`} sub={<><Chip v={p.status} /> · owner {p.owner?.full_name ?? "unassigned"} · due {date(p.due_on)}</>} />
      {msg && <div className="notice" role="status">{msg}</div>}
      {p.blocker && <div className="notice" style={{ borderColor: "var(--bad)" }}><b>Blocked:</b> {p.blocker}</div>}
      <div className="card"><div className="kv">
        <div><span className="mut">Deal expects</span><b>{money(Number(p.expected), cur)}</b><span className="mut" style={{ fontSize: 12 }}>{p.calc}</span></div>
        <div><span className="mut">Adjustments</span><b>{money(sum.adjustments, cur)}</b></div>
        <div><span className="mut">Adjusted expected</span><b>{money(sum.adjusted, cur)}</b></div>
        <div><span className="mut">Tracker says</span><b>{money(p.tracker_amount == null ? null : Number(p.tracker_amount), cur)}</b></div>
        <div><span className="mut">Gap (expected − tracker)</span><b style={{ color: sum.gap ? "var(--bad)" : undefined }}>{sum.gap == null ? "—" : money(sum.gap, cur)}</b></div>
        <div><span className="mut">Invoiced</span><b>{money(p.invoiced_amount == null ? null : Number(p.invoiced_amount), cur)}</b><span className="mut" style={{ fontSize: 12 }}>{p.invoice_number}</span></div>
        {p.agreed_amount != null && <div><span className="mut">Agreed to pay</span><b>{money(Number(p.agreed_amount), cur)}</b><span className="mut" style={{ fontSize: 12 }}>by {p.decider?.full_name ?? "—"} {ago(p.decided_at)}</span></div>}
      </div>{p.decision && <p className="mut" style={{ margin: "12px 0 0" }}>Decision: {p.decision}</p>}</div>

      <h2>Adjustments</h2>
      {!(adj ?? []).length ? <Empty title="No adjustments">Add a line when something is missing from the statement, for example a bonus. Tracker and invoice amounts stay as they are.</Empty> :
        <div className="card scroll"><table><tbody>{(adj ?? []).map((a: any) => <tr key={a.id}><td><b>{money(Number(a.amount), cur)}</b></td><td>{a.reason}</td><td className="mut">{a.author?.full_name} · {ago(a.created_at)}</td></tr>)}</tbody></table></div>}
      {can && <form className="row" action={addAdjustment} style={{ marginTop: 12 }}><input type="hidden" name="id" value={id} /><input name="amount" type="number" step="0.01" placeholder="Amount (negative to deduct)" required /><input name="reason" placeholder="Reason" required style={{ flex: 1, minWidth: 200 }} /><button>Add adjustment</button></form>}

      {can && <><h2>Invoice</h2><form className="row" action={recordInvoice}><input type="hidden" name="id" value={id} /><input name="invoice_number" placeholder="Invoice number" required defaultValue={p.invoice_number ?? ""} /><input name="invoiced_amount" type="number" step="0.01" min="0" placeholder="Invoiced amount" required defaultValue={p.invoiced_amount ?? ""} /><button>Record invoice</button></form></>}

      {isAdmin && <><h2>Decision</h2>
        <form className="card" action={recordDecision}><input type="hidden" name="id" value={id} />
          <div className="formgrid">
            <label>Pay<select name="decision" defaultValue="pay_expected"><option value="pay_expected">What the deal expects ({money(sum.adjusted, cur)})</option><option value="pay_tracker" disabled={p.tracker_amount == null}>What the tracker says ({money(p.tracker_amount == null ? null : Number(p.tracker_amount), cur)})</option><option value="custom">A custom amount</option></select></label>
            <label>Custom amount<input name="custom_amount" type="number" step="0.01" min="0" /></label>
            <label>Reason<input name="reason" placeholder="Required for a custom amount" /></label>
            <button className="pri">Record decision</button>
          </div></form></>}

      {can && next && <div className="toolbar" style={{ marginTop: 16 }}><form action={step}><input type="hidden" name="id" value={id} /><button name="status" value={next}>Mark as {next.replace(/_/g, " ")}</button></form></div>}
    </>
  );
}
