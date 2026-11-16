"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { parseAuthHash } from "@/lib/invite";

type State = { step: "checking" } | { step: "password" } | { step: "error"; message: string };

function Accept() {
  const router = useRouter(), params = useSearchParams();
  const [state, setState] = useState<State>({ step: "checking" });
  const [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const db = supabaseBrowser(), h = parseAuthHash(window.location.hash), code = params.get("code");
      if (h.error) return setState({ step: "error", message: h.errorDescription?.replace(/\+/g, " ") ?? "This invite link is invalid or has expired." });
      if (h.accessToken && h.refreshToken) {
        const { error } = await db.auth.setSession({ access_token: h.accessToken, refresh_token: h.refreshToken });
        if (error) return setState({ step: "error", message: error.message });
      } else if (code) {
        const { error } = await db.auth.exchangeCodeForSession(code);
        if (error) return setState({ step: "error", message: error.message });
      } else {
        const { data } = await db.auth.getUser();                       // already signed in (e.g. the link was opened twice)
        if (!data.user) return setState({ step: "error", message: "This invite link is incomplete. Ask your admin to resend it." });
      }
      window.history.replaceState(null, "", "/auth/accept");           // keep the tokens out of the address bar and history
      setState({ step: "password" });
    })();
  }, [params]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    if (error) { setErr(error.message); setBusy(false); return; }
    router.replace("/inbox"); router.refresh();
  }

  return (
    <div className="auth"><section className="hero"><div className="brand"><span className="logo">A</span><b style={{ color: "#fff", fontSize: 20 }}>ARMPIT</b></div><h2>Welcome to the team.</h2><p>Choose a password to finish joining your workspace.</p></section>
      <section className="panel">
        {state.step === "checking" && <p className="mut">Checking your invite…</p>}
        {state.step === "error" && <div style={{ maxWidth: 360 }}><h1>Invite problem</h1><p>{state.message}</p><p className="mut">Ask your admin to resend the invite, or <a href="/login" style={{ color: "var(--brand)" }}>sign in</a> if you already have a password.</p></div>}
        {state.step === "password" && <form onSubmit={save}><h1>Set your password</h1>
          <input type="password" placeholder="Password (8+ characters)" minLength={8} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          {err && <div className="notice" role="alert" style={{ borderColor: "var(--bad)", background: "transparent", margin: 0 }}>{err}</div>}
          <button className="pri" disabled={busy}>{busy ? "Saving…" : "Join workspace"}</button></form>}
      </section></div>
  );
}
export default function AcceptPage() { return <Suspense fallback={null}><Accept /></Suspense>; }
