import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";

async function addPartner(fd: FormData) {
  "use server";
  const { db, org, member } = await requireSession();
  const { error } = await db.from("partners").insert({
    org_id: org.id, name: String(fd.get("name")), type: String(fd.get("type")), email: String(fd.get("email") || "") || null,
    contact_name: String(fd.get("contact") || "") || null, owner_id: member.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/partners");
}

export default async function Partners({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const { q, view } = await searchParams;
  const { db } = await requireSession();
  let query = db.from("partners").select("id,name,type,contact_name,geos,owner:members!owner_id(full_name),status:partner_statuses(name,color)").order("name");
  if (q) query = query.ilike("name", `%${q}%`);
  const { data: partners = [] } = await query;
  const { data: statuses = [] } = await db.from("partner_statuses").select("id,name,color").order("position");

  return (
    <>
      <h1>Partners</h1>
      <form className="row">
        <input name="q" defaultValue={q} placeholder="Search partners" />
        <button name="view" value="list">List</button><button name="view" value="board">Pipeline</button>
      </form>
      <form className="row" action={addPartner}>
        <input name="name" placeholder="Partner name" required />
        <select name="type"><option value="publisher">Publisher</option><option value="advertiser">Advertiser</option></select>
        <input name="contact" placeholder="Contact" /><input name="email" type="email" placeholder="Email" />
        <button className="pri">Add partner</button>
      </form>
      {view === "board" ? (
        <div className="board">
          {statuses!.map((s) => (
            <div className="col card" key={s.id}>
              <h3><Chip v={s.name} color={s.color} /></h3>
              {partners!.filter((p: any) => p.status?.name === s.name).map((p: any) => <div key={p.id}><Link href={`/partners/${p.id}`}>{p.name}</Link></div>)}
            </div>
          ))}
        </div>
      ) : (
        <div className="card"><table>
          <thead><tr><th>Partner</th><th>Type</th><th>Stage</th><th>Owner</th><th>GEOs</th></tr></thead>
          <tbody>{partners!.map((p: any) => (
            <tr key={p.id}><td><Link href={`/partners/${p.id}`}>{p.name}</Link><div className="mut">{p.contact_name}</div></td>
              <td>{p.type}</td><td>{p.status && <Chip v={p.status.name} color={p.status.color} />}</td>
              <td>{p.owner?.full_name ?? "Unassigned"}</td><td>{p.geos?.join(", ")}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
