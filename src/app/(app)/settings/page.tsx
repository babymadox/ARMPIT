import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";

export default async function Settings() {
  const { db, org, isAdmin } = await requireSession();
  const [{ data: trackers = [] }, { data: audit = [] }] = await Promise.all([
    db.from("tracker_connections").select("id,kind,label,status,last_synced_at"),
    isAdmin ? db.from("audit_log").select("id,action,entity,created_at").order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
  ]);
  return (
    <>
      <h1>Settings</h1>
      <div className="card"><h2>Organization</h2><p>{org.name} · {org.plan} plan · {org.seats} seats</p></div>
      <h2>Integrations</h2>
      <div className="card">{trackers!.map((t: any) => <p key={t.id}>{t.kind} <Chip v={t.status} /></p>)}{!trackers!.length && <span className="mut">No trackers connected. Adapters live in src/lib/integrations/trackers.</span>}</div>
      <h2>Billing</h2><div className="card mut">TODO: Stripe Checkout and customer portal, driven by seats.</div>
      {isAdmin && <><h2>Audit log</h2><div className="card">{audit!.map((a: any) => <div key={a.id}>{a.action} <span className="mut">{a.entity}</span></div>)}</div></>}
    </>
  );
}
