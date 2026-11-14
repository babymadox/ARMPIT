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
    <div className="center card">
      <h1>ARMPIT</h1>
      <form action={auth}>
        <input name="email" type="email" placeholder="Work email" required />
        <input name="password" type="password" placeholder="Password" minLength={8} required />
        {error && <span style={{ color: "var(--bad)" }}>{error}</span>}
        <button className="pri" name="mode" value="signin">Sign in</button>
        <button name="mode" value="signup">Create account</button>
      </form>
    </div>
  );
}
