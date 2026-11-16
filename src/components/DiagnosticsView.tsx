import Link from "next/link";
import { effective, nextActions, toMarkdown, type Report } from "@/lib/report";
import { FEATURES } from "@/lib/features";
import { PageHeader } from "@/components/ui";
import { CopyReport } from "@/components/CopyReport";
import { ago } from "@/lib/format";

const tone = (s: string) => (s === "ok" || s === "working" ? "ok" : s === "fail" || s === "blocked" ? "warn" : "");


/** Presentational: takes a finished report, so it can be rendered with sample data for visual checks. */
export function DiagnosticsView({ report }: { report: Report }) {
  const md = toMarkdown(report), actions = nextActions(report);
  return (
    <>
      <p className="mut"><Link href="/settings">← Settings</Link></p>
      <PageHeader title="Diagnostics" sub={<>Generated {ago(report.generatedAt)} · commit {report.app.commit ?? "unknown"} · {report.app.env ?? "unknown"}</>} actions={<><CopyReport text={md} /><Link href="/settings/diagnostics"><button type="button">Refresh</button></Link></>} />
      <div className="notice">To get help, press <b>Copy report</b> and paste it into the chat. It contains no passwords, keys or message text.</div>

      <h2>Next actions</h2>
      {actions.length ? <div className="card"><ol style={{ margin: 0, paddingLeft: 20 }}>{actions.map((a) => <li key={a}>{a}</li>)}</ol></div> : <div className="empty"><b>Nothing outstanding</b></div>}

      {(["Environment", "Database", "Integrations"] as const).map((g) => (
        <section key={g}><h2>{g}</h2>
          <div className="card scroll"><table><tbody>{report.checks.filter((c) => c.group === g).map((c) => (
            <tr key={c.id}><td>{c.label}</td><td><span className={`pill ${tone(c.status)}`}>{c.status.toUpperCase()}</span></td><td className="mut">{c.detail}</td></tr>))}</tbody></table></div></section>))}

      <h2>Features</h2>
      <div className="card scroll"><table><thead><tr><th>Area</th><th>Feature</th><th>State</th><th>Note</th></tr></thead><tbody>{FEATURES.map((f) => { const e = effective(f, report); return (
        <tr key={f.id}><td>{f.area}</td><td>{f.name}</td><td><span className={`pill ${tone(e.status)}`}>{e.status}</span></td><td className="mut">{e.why ?? f.note}</td></tr>); })}</tbody></table></div>

      <h2>Last proven working</h2>
      <div className="card scroll"><table><tbody>{report.evidence.map((e) => <tr key={e.id}><td>{e.label}</td><td>{e.at ? ago(e.at) : <span className="pill warn">never</span>}</td><td className="mut">{e.detail}</td></tr>)}</tbody></table></div>

      <h2>Recent events</h2>
      {!report.events.length ? <div className="empty"><b>No events recorded yet</b><p>If the app_events check above fails, run migration 9.</p></div> :
        <div className="card scroll"><table><tbody>{report.events.map((e, i) => (
          <tr key={i}><td><span className={`pill ${e.level === "error" ? "warn" : e.level === "warn" ? "warn" : ""}`}>{e.level}</span></td><td>{e.source}</td><td>{e.message}{e.digest && <span className="mut"> · digest {e.digest}</span>}</td><td className="mut">{ago(e.created_at)}</td></tr>))}</tbody></table></div>}
    </>
  );
}
