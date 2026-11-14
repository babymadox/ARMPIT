import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { Chip } from "@/components/Chip";

async function invite(fd: FormData) {
  "use server";
  const { db, org, member } = await requireSession();
  if (member.role === "member") throw new Error("Admins only");
  const { count } = await db.from("members").select("id", { count: "exact", head: true }).eq("org_id", org.id).neq("status", "suspended");
  if ((count ?? 0) >= org.seats) throw new Error("No free seats. Add seats in Billing.");
  const { error } = await db.from("members").insert({ org_id: org.id, email: String(fd.get("email")).toLowerCase(), role: String(fd.get("role")), status: "invited" });
  if (error) throw new Error(error.message);
  // TODO: send the invite email (Supabase Auth admin.inviteUserByEmail from a server-only route).
  revalidatePath("/team");
}

export default async function Team() {
  const { db, isAdmin, org } = await requireSession();
  const { data: rows = [] } = await db.from("members").select("id,full_name,email,role,status,team_name,last_seen_at").order("created_at");
  return (
    <>
      <h1>Team <span className="mut" style={{ fontSize: 14 }}>{rows!.length}/{org.seats} seats</span></h1>
      {isAdmin && <form className="row" action={invite}><input name="email" type="email" placeholder="Email" required /><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select><button className="pri">Invite</button></form>}
      <div className="card"><table><tbody>{rows!.map((m: any) => <tr key={m.id}><td>{m.full_name ?? m.email}<div className="mut">{m.email}</div></td><td>{m.role.replace("_", " ")}</td><td>{m.team_name}</td><td><Chip v={m.status} /></td></tr>)}</tbody></table></div>
    </>
  );
}
