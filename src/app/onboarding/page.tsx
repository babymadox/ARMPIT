import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { looksLikeCode } from "@/lib/activation";

async function create(formData: FormData) {
  "use server";
  const code = String(formData.get("code") ?? "");
  if (!looksLikeCode(code)) redirect(`/onboarding?error=${encodeURIComponent("That does not look like an activation code. It has the form ARMPIT-XXXX-XXXX-XXXX-XXXX.")}`);
  const db = await supabaseServer();
  // The database checks the code and refuses to create the workspace without a valid, unused one.
  const { error } = await db.rpc("create_organization", { org_name: String(formData.get("org")), full_name: String(formData.get("name")), activation_code: code });
  if (error) redirect(`/onboarding?error=${encodeURIComponent(error.message.includes("activation code") ? error.message : "Could not create the workspace. Check the code and try again.")}`);
  redirect("/inbox");
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth">
      <section className="hero"><div className="brand"><span className="logo">A</span><b style={{ color: "#fff", fontSize: 20 }}>ARMPIT</b></div><h2>Let's set up your workspace.</h2><p>It takes a few seconds. You will need the activation code you received when you signed up for ARMPIT.</p></section>
      <section className="panel">
        <form action={create}>
          <h1>Your workspace</h1>
          <input name="name" placeholder="Your name" required />
          <input name="org" placeholder="Company name" required />
          <input name="code" placeholder="Activation code (ARMPIT-XXXX-XXXX-XXXX-XXXX)" required autoComplete="off" spellCheck={false} style={{ fontFamily: "ui-monospace, monospace" }} />
          {error && <div className="notice" role="alert" style={{ borderColor: "var(--bad)", background: "transparent", margin: 0 }}>{error}</div>}
          <button className="pri">Create workspace</button>
        </form>
      </section>
    </div>
  );
}
