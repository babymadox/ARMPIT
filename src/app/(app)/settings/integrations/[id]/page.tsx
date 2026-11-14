import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackers } from "@/lib/integrations";
import { readCreds } from "@/lib/secrets";
import { syncConnection } from "@/lib/sync";
import { suggestPartner } from "@/lib/suggest";
import { Chip } from "@/components/Chip";
import { ago } from "@/lib/format";

/** Every action re-checks admin + that the connection belongs to the caller's org (RLS read via the user client). */
async function guard(connectionId: string) {
  const s = await requireSession();
  if (!s.isAdmin) throw new Error("Admins only");
  const { data: conn } = await s.db.from("tracker_connections").select("id,kind,vault_secret_id").eq("id", connectionId).maybeSingle();
  if (!conn) throw new Error("Connection not found");
  return { ...s, conn };
}
const back = (id: string, msg?: string) => redirect(`/settings/integrations/${id}${msg ? `?msg=${encodeURIComponent(msg)}` : ""}`);

async function refreshSources(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), { org, conn } = await guard(id);
  const adapter = trackers[conn.kind as keyof typeof trackers];
  let found;
  try { found = await adapter.listAffiliates(await readCreds(conn.vault_secret_id)); }
  catch (e) { back(id, `Could not load sources: ${e instanceof Error ? e.message : e}`); return; }
  if (found.length) await supabaseAdmin().from("tracker_sources").upsert(found.map((f) => ({ org_id: org.id, connection_id: id, external_id: f.externalId, name: f.name, last_seen_at: new Date().toISOString() })), { onConflict: "connection_id,external_id" });
  revalidatePath(`/settings/integrations/${id}`);
  back(id, `Found ${found.length} sources`);
}

async function linkSource(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), ext = String(fd.get("ext")), partnerId = String(fd.get("partner") ?? "");
  const { db, org } = await guard(id);
  if (!partnerId) return back(id, "Choose a partner first");
  const { data: p } = await db.from("partners").select("id").eq("id", partnerId).maybeSingle();   // RLS: must be in my org
  if (!p) throw new Error("Partner not found");
  const { error } = await supabaseAdmin().from("partner_links").insert({ org_id: org.id, partner_id: partnerId, connection_id: id, external_id: ext });
  if (error) return back(id, error.code === "23505" ? "That source is already linked" : error.message);
  const r = await syncConnection(id, 30).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));   // backfill so the partner page has data now
  back(id, "error" in r ? `Linked, but the backfill failed: ${r.error}` : `Linked. Backfilled ${r.rows} rows`);
}

async function createAndLink(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), ext = String(fd.get("ext"));
  const { db, org, member } = await guard(id);
  const { data: p, error } = await db.from("partners").insert({ org_id: org.id, name: ext, type: "publisher", owner_id: member.id }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabaseAdmin().from("partner_links").insert({ org_id: org.id, partner_id: p.id, connection_id: id, external_id: ext });
  if (e2) return back(id, e2.message);
  await syncConnection(id, 30).catch(() => {});
  back(id, `Created partner "${ext}" and linked it`);
}

async function unlink(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")), { org } = await guard(id);
  // Deleting the link also deletes the stats synced for it (FK cascade). Relinking backfills 30 days.
  await supabaseAdmin().from("partner_links").delete().eq("id", String(fd.get("link"))).eq("org_id", org.id).eq("connection_id", id);
  back(id, "Unlinked");
}

async function syncNow(fd: FormData) {
  "use server";
  const id = String(fd.get("conn")); await guard(id);
  const r = await syncConnection(id, 30).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  back(id, "error" in r ? `Sync failed: ${r.error}` : `Synced: ${r.sources} sources, ${r.rows} rows`);
}

export default async function SourcesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; show?: string }> }) {
  const { id } = await params, { msg, show } = await searchParams;
  const { db, isAdmin } = await requireSession();
  const { data: conn } = await db.from("tracker_connections").select("id,kind,label,status,last_synced_at").eq("id", id).maybeSingle();
  if (!conn) notFound();
  const [{ data: sources = [] }, { data: links = [] }, { data: partners = [] }] = await Promise.all([
    db.from("tracker_sources").select("external_id,name,last_seen_at").eq("connection_id", id).order("name"),
    db.from("partner_links").select("id,external_id,partner:partners(id,name)").eq("connection_id", id),
    db.from("partners").select("id,name").order("name"),
  ]);
  const linkOf = new Map(links!.map((l: any) => [l.external_id, l]));
  // Sources that have a link but were never catalogued (e.g. linked before this screen existed) still show up.
  const all = [...sources!, ...links!.filter((l: any) => !sources!.some((s: any) => s.external_id === l.external_id)).map((l: any) => ({ external_id: l.external_id, name: l.external_id, last_seen_at: null }))];
  const rows = (show === "unlinked" ? all.filter((s: any) => !linkOf.has(s.external_id)) : all);
  const unlinkedCount = all.filter((s: any) => !linkOf.has(s.external_id)).length;

  return (
    <>
      <p className="mut"><Link href="/settings">← Settings</Link></p>
      <h1>{conn.label ?? conn.kind} sources</h1>
      <p className="mut">{conn.kind} · <Chip v={conn.status} /> · last synced {ago(conn.last_synced_at)} · {links!.length} linked, {unlinkedCount} not linked</p>
      {msg && <div className="card" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      {isAdmin && (
        <div className="row">
          <form action={refreshSources}><input type="hidden" name="conn" value={id} /><button>Refresh sources</button></form>
          <form action={syncNow}><input type="hidden" name="conn" value={id} /><button>Sync last 30 days</button></form>
          <Link href={show === "unlinked" ? `?` : `?show=unlinked`}><button type="button">{show === "unlinked" ? "Show all" : "Show only unlinked"}</button></Link>
        </div>
      )}
      <div className="card"><table>
        <thead><tr><th>Source</th><th>Last seen</th><th>Partner</th>{isAdmin && <th />}</tr></thead>
        <tbody>{rows.map((s: any) => {
          const l: any = linkOf.get(s.external_id), hint = l ? null : suggestPartner(s.name, partners!);
          return (
            <tr key={s.external_id}>
              <td>{s.name}</td><td className="mut">{ago(s.last_seen_at)}</td>
              <td>{l ? <Link href={`/partners/${l.partner.id}`}>{l.partner.name}</Link> : <span className="mut">Not linked{hint ? ` · looks like ${hint.name}` : ""}</span>}</td>
              {isAdmin && <td>{l ? (
                <form action={unlink}><input type="hidden" name="conn" value={id} /><input type="hidden" name="link" value={l.id} /><button title="Also deletes the stats synced for this source">Unlink</button></form>
              ) : (
                <div className="row" style={{ margin: 0 }}>
                  <form action={linkSource} className="row" style={{ margin: 0 }}>
                    <input type="hidden" name="conn" value={id} /><input type="hidden" name="ext" value={s.external_id} />
                    <select name="partner" defaultValue={hint?.id ?? ""} aria-label={`Partner for ${s.name}`}>
                      <option value="">Choose partner…</option>{partners!.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="pri">Link</button>
                  </form>
                  <form action={createAndLink}><input type="hidden" name="conn" value={id} /><input type="hidden" name="ext" value={s.external_id} /><button title="Creates a publisher with this name and links it">New partner</button></form>
                </div>)}</td>}
            </tr>);
        })}</tbody>
      </table>
      {!rows.length && <p className="mut" style={{ padding: 12 }}>No sources yet. Click “Refresh sources” to load them from {conn.kind}.</p>}
      </div>
    </>
  );
}
