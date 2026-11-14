import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { ago } from "@/lib/format";

async function toggle(fd: FormData) {
  "use server";
  const { db } = await requireSession(); // RLS: only admins can write
  { const { error: werr } = await db.from("automations").update({ enabled: fd.get("on") === "1" }).eq("id", String(fd.get("id"))); if (werr) throw new Error(werr.message); }
  revalidatePath("/automations");
}
async function create(fd: FormData) {
  "use server";
  const { db, org } = await requireSession();
  const tpl = String(fd.get("tpl"));
  const T: Record<string, any> = {
    volume_drop: { name: "Volume drop", trigger: { type: "metric_drop", pct: 30, vs: "last_7_days" }, actions: [{ type: "notify", who: "assignee" }] },
    silent_partner: { name: "Silent partner", trigger: { type: "no_message", days: 3 }, actions: [{ type: "create_task", who: "assignee" }] },
    cap_reached: { name: "Cap almost reached", trigger: { type: "cap_pct", pct: 90 }, actions: [{ type: "notify", who: "deal_owner" }] },
  };
  { const { error: werr } = await db.from("automations").insert({ org_id: org.id, ...T[tpl] }); if (werr) throw new Error(werr.message); }
  revalidatePath("/automations");
}

export default async function Automations() {
  const { db, isAdmin } = await requireSession();
  const { data: rows = [] } = await db.from("automations").select("*").order("created_at");
  return (
    <>
      <h1>Automations</h1>
      {isAdmin && <form className="row" action={create}><select name="tpl"><option value="volume_drop">Volume drop</option><option value="silent_partner">Silent partner</option><option value="cap_reached">Cap almost reached</option></select><button className="pri">Add from template</button></form>}
      <div className="card"><table><tbody>{rows!.map((a: any) => (
        <tr key={a.id}><td>{a.name}<div className="mut">{JSON.stringify(a.trigger)}</div></td><td>{a.runs} runs · {ago(a.last_run_at)}</td>
          <td>{isAdmin && <form action={toggle}><input type="hidden" name="id" value={a.id} /><button name="on" value={a.enabled ? "0" : "1"}>{a.enabled ? "On" : "Off"}</button></form>}</td></tr>))}</tbody></table></div>
    </>
  );
}
