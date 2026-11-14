import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { org, member } = await requireSession();
  return (
    <div className="shell">
      <Sidebar org={org.name} user={member.full_name ?? member.email} />
      <main>{children}</main>
    </div>
  );
}
