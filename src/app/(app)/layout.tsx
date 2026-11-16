import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { BellLive } from "@/components/BellLive";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, org, member } = await requireSession();
  // Unread count for the bell. If the notifications migration is missing this is simply 0: never break the page for a badge.
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return (
    <div className="shell">
      <Sidebar org={org.name} user={member.full_name ?? member.email} unread={count ?? 0} />
      <BellLive memberId={member.id} />
      <main>{children}</main>
    </div>
  );
}
