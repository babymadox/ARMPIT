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
    <div className="center card">
      <h1>Set up your workspace</h1>
      <form action={create}>
        <input name="name" placeholder="Your name" required />
        <input name="org" placeholder="Company name" required />
        <button className="pri">Continue</button>
      </form>
    </div>
  );
}
