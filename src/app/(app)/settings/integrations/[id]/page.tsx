export const maxDuration = 60; // import/sync wait on Singular async reports
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncConnection } from "@/lib/sync";
import { Chip } from "@/components/Chip";
import { PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";

/** Every action re-checks admin + that the connection belongs to the caller's org (RLS read via the user client). */
async function guard(connectionId: string) {
  const s = await requireSession();
  if (!s.isAdmin) throw new Error("Admins only");
  const { data: conn } = await s.db.from("tracker_connections").select("id").eq("id", connectionId).maybeSingle();
  if (!conn) throw new Error("Connection not found");
  return s;
}
const back = (id: string, msg?: string, view?: string) => redirect(`/settings/integrations/${id}?${new URLSearchParams({ ...(view ? { view } : {}), ...(msg ? { msg } : {}) })}`);

async function importStructure(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), { member, org } = await guard(id);
  const r = await syncConnection({ orgId: org.id }, id, 30, { autoLink: true, ownerId: member.id }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  back(id, "error" in r ? `Import failed: ${r.error}` : `Imported: ${r.createdPartners} new partners, ${r.createdLinks} new source links, ${r.rows} data rows`);
}
async function syncNow(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), { org } = await guard(id);
  const r = await syncConnection({ orgId: org.id }, id, 30).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  back(id, "error" in r ? `Sync failed: ${r.error}` : `Synced ${r.rows} data rows across ${r.pairs} source/agency pairs`);
}
/** Map one Singular agency to an existing partner: links all of that agency's sources to it. */
async function mapAgency(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), agency = String(fd.get("agency")), partnerId = String(fd.get("partner") ?? "");
  const { db, org } = await guard(id);
  if (!partnerId) return back(id, "Choose a partner first", "agency");
  const { data: p } = await db.from("partners").select("id").eq("id", partnerId).maybeSingle();   // RLS: must be in my org
  if (!p) throw new Error("Partner not found");
  const admin = supabaseAdmin();
  const { data: pairs = [], error: e1 } = await admin.from("tracker_sources").select("external_id").eq("org_id", org.id).eq("connection_id", id).eq("external_group", agency);
  if (e1) return back(id, `Could not read sources: ${e1.message}`, "agency");
  if (!pairs!.length) return back(id, `No sources found for ${agency}`, "agency");
  const { error: e2 } = await admin.from("partner_links").upsert(pairs!.map((x) => ({ org_id: org.id, connection_id: id, partner_id: partnerId, external_id: x.external_id, external_group: agency })), { onConflict: "connection_id,external_id,external_group" });
  if (e2) return back(id, `Could not map ${agency}: ${e2.message}`, "agency");   // never report success for a failed write
  const r = await syncConnection({ orgId: org.id }, id, 30).catch(() => null);
  back(id, `Mapped ${agency} to the partner (${pairs!.length} sources)${r ? "" : ". Backfill failed, try Sync"}`, "agency");
}
async function unlinkAgency(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), agency = String(fd.get("agency")), { org } = await guard(id);
  // Deleting links also deletes the stats synced for them (FK cascade). Import or map again to backfill 30 days.
  const { error } = await supabaseAdmin().from("partner_links").delete().eq("connection_id", id).eq("org_id", org.id).eq("external_group", agency);
  if (error) return back(id, `Could not unlink ${agency}: ${error.message}`, "agency");
  back(id, `Unlinked ${agency}`, "agency");
}

type Pair = { external_id: string; external_group: string };
export default async function StructurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; view?: string; q?: string }> }) {
  const { id } = await params, { msg, view = "agency", q = "" } = await searchParams;
  const { db, isAdmin } = await requireSession();
  const { data: conn } = await db.from("tracker_connections").select("id,kind,label,status,last_synced_at").eq("id", id).maybeSingle();
  if (!conn) notFound();
  const [{ data: pairs = [] }, { data: links = [] }, { data: partners = [] }] = await Promise.all([
    db.from("tracker_sources").select("external_id,external_group").eq("connection_id", id).limit(20000),
    db.from("partner_links").select("external_id,external_group,partner:partners(id,name)").eq("connection_id", id).limit(20000),
    db.from("partners").select("id,name").order("name"),
  ]);
  const partnerOf = new Map<string, { id: string; name: string }>();            // agency -> partner
  links!.forEach((l: any) => { if (l.partner) partnerOf.set(l.external_group, l.partner); });
  const byAgency = new Map<string, string[]>(), bySource = new Map<string, string[]>();
  (pairs as Pair[]).forEach((p) => {
    if (p.external_group) (byAgency.get(p.external_group) ?? byAgency.set(p.external_group, []).get(p.external_group)!).push(p.external_id);
    (bySource.get(p.external_id) ?? bySource.set(p.external_id, []).get(p.external_id)!).push(p.external_group);
  });
  const needle = q.trim().toLowerCase(), hit = (s: string) => !needle || s.toLowerCase().includes(needle);
  const agencies = [...byAgency].filter(([a, srcs]) => hit(a) || srcs.some(hit)).sort((a, b) => b[1].length - a[1].length);
  const sources = [...bySource].filter(([s, ags]) => hit(s) || ags.some(hit)).sort((a, b) => b[1].length - a[1].length);
  const shared = [...bySource.values()].filter((a) => a.length > 1).length;
  const tab = (v: string, l: string) => <Link className={`tab${view === v ? " on" : ""}`} href={`?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>{l}</Link>;

  return (
    <>
      <p className="mut"><Link href="/settings">← Settings</Link></p>
      <PageHeader title={`${conn.label ?? conn.kind}: agencies & sources`}
        sub={<>{byAgency.size} agencies · {bySource.size} sources · {shared} sources shared by several agencies · <Chip v={conn.status} /> · synced {ago(conn.last_synced_at)}</>} />
      {msg && <div className="notice" role="status">{msg}</div>}
      {isAdmin && (
        <div className="toolbar">
          <form action={importStructure}><input type="hidden" name="conn" value={id} /><button className="pri">Import structure from {conn.kind}</button></form>
          <form action={syncNow}><input type="hidden" name="conn" value={id} /><button>Sync last 30 days</button></form>
          <span className="mut">Import creates a partner for each agency and links every source it works with, exactly as in {conn.kind}. Safe to repeat.</span>
        </div>
      )}
      <div className="toolbar">
        <div className="tabs">{tab("agency", "By agency")}{tab("source", "By source")}</div>
        <form className="search"><input type="hidden" name="view" value={view} /><input name="q" defaultValue={q} placeholder="Search agencies or sources" /></form>
      </div>

      {view === "source" ? (
        <div className="grid2">{sources.slice(0, 200).map(([s, ags]) => (
          <div className="card" key={s}><b>{s}</b><div className="mut">{ags.filter(Boolean).length} agenc{ags.filter(Boolean).length === 1 ? "y" : "ies"}</div>
            <div className="chips">{ags.filter(Boolean).map((a) => partnerOf.get(a) ? <Link className="pill ok" key={a} href={`/partners/${partnerOf.get(a)!.id}`}>{a}</Link> : <span className="pill" key={a}>{a}</span>)}</div></div>))}</div>
      ) : (
        <div className="grid2">{agencies.slice(0, 200).map(([a, srcs]) => {
          const p = partnerOf.get(a);
          return (
            <div className="card" key={a}>
              <div className="between"><b>{a}</b>{p ? <Link className="pill ok" href={`/partners/${p.id}`}>Partner ✓</Link> : <span className="pill warn">Not linked</span>}</div>
              <div className="mut">{srcs.length} source{srcs.length === 1 ? "" : "s"}</div>
              <div className="chips">{srcs.slice(0, 12).map((s) => <span className="pill" key={s}>{s}{(bySource.get(s)?.length ?? 0) > 1 && <i title="Shared with other agencies"> ⇄</i>}</span>)}{srcs.length > 12 && <span className="pill mut">+{srcs.length - 12}</span>}</div>
              {isAdmin && (p ? (
                <form action={unlinkAgency} style={{ marginTop: 10 }}><input type="hidden" name="conn" value={id} /><input type="hidden" name="agency" value={a} /><button title="Also deletes the stats synced for this agency">Unlink</button></form>
              ) : (
                <form action={mapAgency} className="row" style={{ marginTop: 10, marginBottom: 0 }}><input type="hidden" name="conn" value={id} /><input type="hidden" name="agency" value={a} />
                  <select name="partner" aria-label={`Partner for ${a}`}><option value="">Map to existing partner…</option>{partners!.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button>Map</button></form>
              ))}
            </div>);
        })}</div>
      )}
      {!pairs!.length && <div className="empty"><b>Nothing here yet</b><p>Click “Import structure from {conn.kind}” to load your agencies and sources.</p></div>}
      {(view === "source" ? sources : agencies).length > 200 && <p className="mut">Showing the first 200. Use search to narrow down.</p>}
    </>
  );
}
