export const maxDuration = 60;
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Empty, PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";
import { parse, automationSchema } from "@/lib/validation";
import { fromTemplate } from "@/lib/automation-templates";
import { humanize, runAutomations } from "@/lib/automations";
import { audit } from "@/lib/audit";
import { errMsg, logEvent } from "@/lib/log";

const back = (msg: string) => redirect(`/automations?msg=${encodeURIComponent(msg)}`);
const who = (a: any) => (a.actions ?? []).map((x: any) => x.type === "create_task" ? "create a task" : x.type === "notify" ? (x.who === "admins" ? "notify admins" : "notify the owner") : x.type).join(" + ") || "notify the owner";

async function toggle(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can change automations");
  const id = String(fd.get("id")), on = fd.get("on") === "1";
  const { error } = await db.from("automations").update({ enabled: on }).eq("id", id);
  if (error) return back(`Could not update: ${error.message}`);
  await audit({ orgId: org.id, actorId: member.id, action: on ? "automation.enable" : "automation.disable", entity: "automation", entityId: id });
  revalidatePath("/automations"); back(on ? "Automation turned on" : "Automation turned off");
}
async function create(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can create automations");
  const r = parse(automationSchema, fd); if (!r.ok) return back(`Could not create: ${r.error}`);
  const a = fromTemplate(r.data.template, r.data.threshold);
  const { data, error } = await db.from("automations").insert({ org_id: org.id, ...a }).select("id").single();
  if (error || !data) return back(`Could not create: ${error?.message}`);
  await audit({ orgId: org.id, actorId: member.id, action: "automation.create", entity: "automation", entityId: data.id, meta: { name: a.name, trigger: a.trigger } });
  revalidatePath("/automations"); back(`Created "${a.name}": ${humanize(a.trigger)}`);
}
async function remove(fd: FormData) {
  "use server";
  const { db, org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can delete automations");
  const id = String(fd.get("id"));
  const { error } = await db.from("automations").delete().eq("id", id);
  if (error) return back(`Could not delete: ${error.message}`);
  await audit({ orgId: org.id, actorId: member.id, action: "automation.delete", entity: "automation", entityId: id });
  revalidatePath("/automations"); back("Automation deleted");
}
/** Runs this workspace's automations right now, so you can see them work without waiting for the daily job. */
async function runNow() {
  "use server";
  const { org, member, isAdmin } = await requireSession();
  if (!isAdmin) return back("Only admins can run automations");
  let msg: string;
  try {
    const res = await runAutomations(supabaseAdmin(), Date.now(), { orgId: org.id });
    const fired = res.reduce((n, r) => n + r.fired, 0), bad = res.filter((r) => r.error || r.skipped);
    await logEvent({ orgId: org.id, level: bad.length ? "warn" : "info", source: "automations.run", message: `manual run: ${res.length} automation(s), ${fired} new alert(s)/task(s), ${bad.length} skipped or failed`, details: { results: res.map((r) => ({ fired: r.fired, skipped: r.skipped, error: r.error })) } });
    await audit({ orgId: org.id, actorId: member.id, action: "automation.run", entity: "automation", meta: { automations: res.length, fired } });
    msg = res.length ? `Ran ${res.length} automation(s): ${fired} new alert(s) or task(s)${bad.length ? `; ${bad.length} skipped or failed (${bad.map((b) => b.error ?? b.skipped).join("; ")})` : ""}` : "There are no enabled automations to run";
  } catch (e) { msg = `The run failed: ${errMsg(e)}`; }
  back(msg);
}

export default async function Automations({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { db, isAdmin } = await requireSession();
  const { data: rows = [], error } = await db.from("automations").select("*").order("created_at");
  return (
    <>
      <PageHeader title="Automations" sub="Alerts and follow-up tasks that run on their own, once a day" actions={isAdmin ? <form action={runNow}><button>Run now</button></form> : undefined} />
      {msg && <div className="notice" role="status">{msg}</div>}
      {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)" }}>{error.message}</div>}
      {isAdmin && (
        <form className="row" action={create}>
          <select name="template" defaultValue="silent_partner" aria-label="Template">
            <option value="silent_partner">Silent partner: no message for N days</option><option value="no_reply">No reply: our message unanswered for N days</option>
            <option value="cap_reached">Cap almost reached: deal at N% of its cap</option><option value="volume_drop">Volume drop: installs down N% vs the previous week</option></select>
          <input name="threshold" type="number" min="1" max="365" placeholder="N (optional)" style={{ width: 130 }} /><button className="pri">Add automation</button>
        </form>)}
      {!(rows ?? []).length ? <Empty icon="automations" title="No automations yet">Pick a template above. Each one raises an alert (and sometimes a task) for the person who owns the partner.</Empty> : (
        <div className="card scroll"><table><tbody>{(rows ?? []).map((a: any) => (
          <tr key={a.id}><td><b>{a.name}</b><div className="mut">{humanize(a.trigger)} → {who(a)}</div></td><td className="mut">{a.runs} alert(s) · last run {a.last_run_at ? ago(a.last_run_at) : "never"}</td>
            <td>{isAdmin && <div className="row" style={{ margin: 0, flexWrap: "nowrap" }}><form action={toggle}><input type="hidden" name="id" value={a.id} /><button name="on" value={a.enabled ? "0" : "1"} className={a.enabled ? "" : "pri"}>{a.enabled ? "On" : "Off"}</button></form><form action={remove}><input type="hidden" name="id" value={a.id} /><button>Delete</button></form></div>}</td></tr>))}</tbody></table></div>)}
    </>
  );
}
