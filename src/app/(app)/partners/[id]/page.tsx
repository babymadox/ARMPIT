import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";
import { Avatar, Empty } from "@/components/ui";
import { money, date, ago } from "@/lib/format";
import { cookies } from "next/headers";
import { ColumnPicker } from "@/components/ColumnPicker";
import { catalogFor, cookieName, formatValue, parseSelection, valueOf, type Totals } from "@/lib/columns";

async function addNote(fd: FormData) {
  "use server";
  const { db, org, member } = await requireSession();
  const id = String(fd.get("id"));
  await db.from("partner_notes").insert({ org_id: org.id, partner_id: id, body: String(fd.get("body")), author_id: member.id });
  revalidatePath(`/partners/${id}`);
}


export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string; sort?: string }> }) {
  const { id } = await params; const sp = await searchParams; const days = [7, 30].includes(Number(sp.days)) ? Number(sp.days) : 7;
  const jar = await cookies();
  const { db } = await requireSession();
  const { data: p } = await db.from("partners").select("*, owner:members!owner_id(full_name), links:partner_links(id,external_id,external_group,connection:tracker_connections(id,kind))").eq("id", id).maybeSingle();
  if (!p) notFound();
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const linkIds = p.links.map((l: any) => l.id);
  const { data: stats = [] } = linkIds.length ? await db.from("tracker_stats").select("link_id,metric,value").in("link_id", linkIds).gte("day", since).limit(50000) : { data: [] };
  const [{ data: deals = [] }, { data: notes = [] }, { data: chats = [] }] = await Promise.all([
    db.from("deals").select("id,brand,kind,amount,rev_share_pct,status,currency").eq("partner_id", id),
    db.from("partner_notes").select("id,kind,body,created_at,author:members(full_name)").eq("partner_id", id).order("created_at", { ascending: false }),
    db.from("conversations").select("id,channel,title,last_message_at").eq("partner_id", id),
  ]);

  // Per source: totals over the window. Totals row sums sources of the SAME tracker only, never across trackers.
  const perLink = new Map<string, Totals>();
  (stats ?? []).forEach((s: any) => { const o = perLink.get(s.link_id) ?? {}; o[s.metric] = (o[s.metric] ?? 0) + Number(s.value); perLink.set(s.link_id, o); });
  const byTracker = new Map<string, any[]>();
  p.links.forEach((l: any) => (byTracker.get(l.connection.kind) ?? byTracker.set(l.connection.kind, []).get(l.connection.kind)!).push(l));

  return (
    <>
      <p className="mut"><Link href="/partners">← Partners</Link></p>
      <header className="phead">
        <div className="who-cell"><Avatar name={p.name} size={52} /><div><h1>{p.name}</h1><p className="mut" style={{ margin: 0 }}>{p.type} · owner {p.owner?.full_name ?? "Unassigned"} · joined {date(p.joined_at)}</p></div></div>
        <div className="tabs">{[7, 30].map((d) => <Link key={d} className={`tab${days === d ? " on" : ""}`} href={`?days=${d}`}>{d} days</Link>)}</div>
      </header>

      <h2>Sources <span className="mut" style={{ fontWeight: 400, fontSize: 14 }}>{p.links.length} linked</span></h2>
      {!p.links.length ? <Empty icon="partners" title="No sources linked">Open Settings → Integrations → your tracker, then import the structure or map this partner to an agency.</Empty> :
        [...byTracker].map(([kind, links]) => {
          const seen = [...new Set((stats ?? []).map((x: any) => x.metric as string))];
          const cat = catalogFor(kind, seen);
          const chosen = parseSelection(jar.get(cookieName(kind))?.value, cat);
          const cols = cat.cols.filter((c) => chosen.includes(c.key));
          const sortKey = cols.some((c) => c.key === sp.sort) ? sp.sort! : cols[0]?.key;
          const rows = links.map((l: any) => ({ l, m: perLink.get(l.id) ?? {} }));
          const sc = cols.find((c) => c.key === sortKey);
          if (sc) rows.sort((a: any, b: any) => (valueOf(sc, b.m) ?? -1) - (valueOf(sc, a.m) ?? -1));
          const tot: Totals = {}; rows.forEach((r: any) => Object.entries(r.m).forEach(([k, v]) => (tot[k] = (tot[k] ?? 0) + (v as number))));
          return (
            <div key={kind} style={{ marginBottom: 18 }}>
              <div className="between" style={{ marginBottom: 8 }}><b>{kind} · {links.length} source{links.length === 1 ? "" : "s"}</b>
                <ColumnPicker cookie={cookieName(kind)} cols={cat.cols} selected={chosen} defaults={cat.defaults} /></div>
              <div className="card scroll"><table>
                <thead><tr><th>Source</th>{cols.map((c) => <th key={c.key} className={`num${c.key === sortKey ? " sorted" : ""}`} title={c.hint}><Link href={`?days=${days}&sort=${c.key}`}>{c.label}{c.key === sortKey ? " ↓" : ""}</Link></th>)}</tr></thead>
                <tbody>{rows.map(({ l, m }: any) => <tr key={l.id}><td>{l.external_id}</td>{cols.map((c) => <td className="num" key={c.key}>{formatValue(c, valueOf(c, m))}</td>)}</tr>)}
                  <tr><td><b>Total</b></td>{cols.map((c) => <td className="num" key={c.key}><b>{formatValue(c, valueOf(c, tot))}</b></td>)}</tr></tbody>
              </table></div>
              {cols.some((c) => c.group === "Network-reported") && <p className="mut" style={{ fontSize: 13, margin: "6px 2px 0" }}>“—” means {kind} has no data for that source. Network-reported columns (impressions, cost) only exist for sources with an ad-network integration.</p>}
            </div>);
        })}

      <h2>Deals</h2>
      {!deals!.length ? <Empty icon="deals" title="No deals yet" /> : <div className="card"><table><tbody>{deals!.map((d: any) => <tr key={d.id}><td>{d.brand}</td><td>{d.kind}</td><td>{money(d.amount, d.currency)}</td><td><Chip v={d.status} /></td></tr>)}</tbody></table></div>}
      <h2>Chats</h2>
      {!chats!.length ? <Empty icon="chat" title="No linked chats" /> : <div className="card">{chats!.map((c: any) => <div key={c.id}>{c.channel}: {c.title} <span className="mut">{ago(c.last_message_at)}</span></div>)}</div>}
      <h2>Timeline</h2>
      <form className="row" action={addNote}><input type="hidden" name="id" value={id} /><input name="body" placeholder="Add a note" style={{ flex: 1 }} required /><button className="pri">Save</button></form>
      <div className="card">{notes!.map((x: any) => <p key={x.id} style={{ margin: "6px 0" }}>{x.body} <span className="mut">· {x.author?.full_name} · {ago(x.created_at)}</span></p>)}{!notes!.length && <span className="mut">No notes yet</span>}</div>
    </>
  );
}
