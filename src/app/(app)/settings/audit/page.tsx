import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Empty, PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";

const PAGE = 50;
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { db, isAdmin } = await requireSession();
  if (!isAdmin) return <><PageHeader title="Audit log" /><Empty title="Admins only" /></>;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { data, error } = await db.from("audit_log").select("id,action,entity,meta,created_at,actor:members(full_name,email)").order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE);   // one extra row tells us there is a next page
  const rows = (data ?? []).slice(0, PAGE), more = (data ?? []).length > PAGE;
  return (
    <>
      <p className="mut"><Link href="/settings">← Settings</Link></p>
      <PageHeader title="Audit log" sub="Who did what in this workspace. Visible to admins only." />
      {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)" }}>{error.message}</div>}
      {!rows.length ? <Empty title="Nothing recorded yet">Changes such as approving a deal, inviting someone or connecting an integration appear here.</Empty> : (
        <div className="card scroll"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>{rows.map((a: any) => (
          <tr key={a.id}><td className="mut">{ago(a.created_at)}</td><td>{a.actor?.full_name ?? a.actor?.email ?? "System"}</td><td><b>{a.action}</b>{a.entity && <span className="mut"> · {a.entity}</span>}</td>
            <td className="mut" style={{ maxWidth: 420, overflowWrap: "anywhere" }}>{a.meta ? JSON.stringify(a.meta).slice(0, 220) : ""}</td></tr>))}</tbody></table></div>)}
      <div className="toolbar" style={{ marginTop: 14 }}>{page > 1 && <Link href={`?page=${page - 1}`}><button>← Newer</button></Link>}{more && <Link href={`?page=${page + 1}`}><button>Older →</button></Link>}</div>
    </>
  );
}
