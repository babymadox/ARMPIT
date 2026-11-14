import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { money, date, ago } from "@/lib/format";

async function addNote(fd: FormData) {
  "use server";
  const { db, org, member } = await requireSession();
  const id = String(fd.get("id"));
  await db.from("partner_notes").insert({ org_id: org.id, partner_id: id, body: String(fd.get("body")), author_id: member.id });
  revalidatePath(`/partners/${id}`);
}

export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  const { id } = await params; const days = Number((await searchParams).days ?? 7);
  const { db } = await requireSession();
  const { data: p } = await db.from("partners").select("*, owner:members!owner_id(full_name), links:partner_links(id,external_id,connection:tracker_connections(kind,currency))").eq("id", id).maybeSingle();
  if (!p) notFound();
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const linkIds = p.links.map((l: any) => l.id);
  // Stats stay per tracker: each link is shown with the metrics its own tracker reports.
  const { data: stats = [] } = linkIds.length ? await db.from("tracker_stats").select("link_id,metric,value").in("link_id", linkIds).gte("day", since) : { data: [] };
  const [{ data: deals = [] }, { data: notes = [] }, { data: chats = [] }] = await Promise.all([
    db.from("deals").select("id,brand,kind,amount,rev_share_pct,status,currency").eq("partner_id", id),
    db.from("partner_notes").select("id,kind,body,created_at,author:members(full_name)").eq("partner_id", id).order("created_at", { ascending: false }),
    db.from("conversations").select("id,channel,title,last_message_at").eq("partner_id", id),
  ]);
  const sum = (linkId: string) => Object.entries((stats ?? []).filter((s: any) => s.link_id === linkId).reduce((a: any, s: any) => ({ ...a, [s.metric]: (a[s.metric] ?? 0) + Number(s.value) }), {}));

  return (
    <>
      <h1>{p.name}</h1>
      <p className="mut">{p.type} · owner {p.owner?.full_name ?? "Unassigned"} · joined {date(p.joined_at)}</p>
      <form className="row">{[7, 30].map((d) => <button key={d} name="days" value={d}>{d} days</button>)}</form>
      <div className="grid">
        {p.links.map((l: any) => (
          <div className="card stat" key={l.id}><span className="mut">{l.connection.kind} · {l.external_id}</span>
            {sum(l.id).map(([m, v]) => <div key={m}>{m}: <b style={{ display: "inline", fontSize: 16 }}>{String(v)}</b></div>)}
            {!sum(l.id).length && <span className="mut">No data yet</span>}</div>))}
        {!p.links.length && <div className="card mut">No tracker linked. Link one in Settings → Integrations.</div>}
      </div>
      <h2>Deals</h2>
      <div className="card"><table><tbody>{deals!.map((d: any) => <tr key={d.id}><td>{d.brand}</td><td>{d.kind}</td><td>{money(d.amount, d.currency)}</td><td><Chip v={d.status} /></td></tr>)}</tbody></table></div>
      <h2>Chats</h2>
      <div className="card">{chats!.map((c: any) => <div key={c.id}>{c.channel}: {c.title} <span className="mut">{ago(c.last_message_at)}</span></div>)}{!chats!.length && <span className="mut">No linked chats</span>}</div>
      <h2>Timeline</h2>
      <form className="row" action={addNote}><input type="hidden" name="id" value={id} /><input name="body" placeholder="Add a note" style={{ flex: 1 }} required /><button className="pri">Save</button></form>
      <div className="card">{notes!.map((n: any) => <p key={n.id}>{n.body} <span className="mut">· {n.author?.full_name} · {ago(n.created_at)}</span></p>)}</div>
    </>
  );
}
