"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };
const IDEAS = ["Which payments need attention?", "Which partners dropped this week?", "What should I follow up today?", "Which deals are close to their cap?"];

export function AgentChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]), [q, setQ] = useState(""), [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  async function ask(text: string) {
    const question = text.trim(); if (!question || busy) return;
    const history = msgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: question }]); setQ(""); setBusy(true);
    try {
      const r = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, history }) });
      const j = await r.json().catch(() => ({}));
      setMsgs((m) => [...m, r.ok ? { role: "assistant", content: j.answer } : { role: "assistant", content: j.error ?? "Something went wrong.", error: true }]);
    } catch { setMsgs((m) => [...m, { role: "assistant", content: "Could not reach the server.", error: true }]); }
    setBusy(false);
  }

  return (
    <div className="card agent">
      <div className="msgs" role="log" aria-live="polite">
        {!msgs.length && <div className="mut" style={{ padding: 8 }}>Ask about your payments, deals, tasks and partner performance. I only read your workspace data and never change anything.
          <div className="chips" style={{ marginTop: 12 }}>{IDEAS.map((i) => <button key={i} type="button" className="pill" onClick={() => ask(i)}>{i}</button>)}</div></div>}
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role === "user" ? "out" : ""}`} style={m.error ? { border: "1px solid var(--bad)" } : undefined}><div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div></div>)}
        {busy && <div className="msg mut">Thinking…</div>}
        <div ref={end} />
      </div>
      <form className="row composer" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" maxLength={1000} style={{ flex: 1 }} aria-label="Question" /><button className="pri" disabled={busy || q.trim().length < 2}>Ask</button>
      </form>
    </div>
  );
}
