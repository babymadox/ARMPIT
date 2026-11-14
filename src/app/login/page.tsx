import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

async function auth(formData: FormData) {
  "use server";
  const db = await supabaseServer();
  const email = String(formData.get("email")), password = String(formData.get("password"));
  const mode = String(formData.get("mode"));
  const { error } = mode === "signup" ? await db.auth.signUp({ email, password }) : await db.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/inbox");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth">
      <section className="hero">
        <div className="brand"><span className="logo">A</span><b style={{ color: "#fff", fontSize: 20 }}>ARMPIT</b></div>
        <h2>One workspace for every partner conversation and every number.</h2>
        <p>Agencies, sources, deals and payouts in one place, straight from your tracker.</p>
        <ul><li>Agencies and sources, mirrored from Singular</li><li>Deals and payment checks against tracker data</li><li>Inbox for every channel your team uses</li></ul>
      </section>
      <section className="panel">
        <form action={auth}>
          <h1>Welcome back</h1><p className="mut" style={{ margin: "0 0 8px" }}>Sign in or create your account.</p>
          <input name="email" type="email" placeholder="Work email" autoComplete="email" required />
          <input name="password" type="password" placeholder="Password (8+ characters)" minLength={8} autoComplete="current-password" required />
          {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)", background: "transparent", margin: 0 }}>{error}</div>}
          <button className="pri" name="mode" value="signin">Sign in</button>
          <button name="mode" value="signup">Create account</button>
        </form>
      </section>
    </div>
  );
}
