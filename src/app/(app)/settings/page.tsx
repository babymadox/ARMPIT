import { requireSession } from "@/lib/session";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Chip } from "@/components/Chip";
import { trackers as adapters } from "@/lib/integrations";
import { storeCreds } from "@/lib/secrets";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function connectTracker(fd: FormData) {
  "use server";
  const { org, isAdmin } = await requireSession();
  if (!isAdmin) throw new Error("Admins only");
  const kind = String(fd.get("kind")) as keyof typeof adapters;
  const creds = { api_key: String(fd.get("api_key")) };
  const test = await adapters[kind].test(creds);                 // never save a key that does not work
  if (!test.ok) throw new Error(`Could not connect: ${test.error}`);
  const secret = await storeCreds(`${org.id}:${kind}`, creds);
  await supabaseAdmin().from("tracker_connections").insert({ org_id: org.id, kind, label: String(fd.get("label") || kind), vault_secret_id: secret });
  revalidatePath("/settings");
}

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
      {isAdmin && <form className="row" action={connectTracker}>
        <select name="kind"><option value="singular">Singular</option></select>
        <input name="label" placeholder="Label (optional)" /><input name="api_key" type="password" placeholder="API key" required />
        <button className="pri">Connect</button></form>}
      <div className="card">{trackers!.map((t: any) => <p key={t.id}>{t.label ?? t.kind} <Chip v={t.status} /> <Link href={`/settings/integrations/${t.id}`}>Manage sources →</Link></p>)}{!trackers!.length && <span className="mut">No trackers connected. Adapters live in src/lib/integrations/trackers.</span>}</div>
      <h2>Billing</h2><div className="card mut">TODO: Stripe Checkout and customer portal, driven by seats.</div>
      {isAdmin && <><h2>Audit log</h2><div className="card">{audit!.map((a: any) => <div key={a.id}>{a.action} <span className="mut">{a.entity}</span></div>)}</div></>}
    </>
  );
}
