import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

async function create(formData: FormData) {
  "use server";
  const db = await supabaseServer();
  const { error } = await db.rpc("create_organization", { org_name: String(formData.get("org")), full_name: String(formData.get("name")) });
  if (error) throw new Error(error.message);
  redirect("/inbox");
}

export default function Onboarding() {
  return (
    <div className="auth">
      <section className="hero"><div className="brand"><span className="logo">A</span><b style={{ color: "#fff", fontSize: 20 }}>ARMPIT</b></div><h2>Let's set up your workspace.</h2><p>It takes a few seconds. You can invite your team and connect Singular next.</p></section>
      <section className="panel">
        <form action={create}>
          <h1>Your workspace</h1>
          <input name="name" placeholder="Your name" required />
          <input name="org" placeholder="Company name" required />
          <button className="pri">Continue</button>
        </form>
      </section>
    </div>
  );
}
