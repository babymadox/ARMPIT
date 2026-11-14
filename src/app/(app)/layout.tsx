import Link from "next/link";
import { requireSession } from "@/lib/session";

const NAV = [["inbox", "Inbox"], ["overview", "Overview"], ["partners", "Partners"], ["deals", "Deals"], ["payments", "Payments"], ["automations", "Automations"], ["team", "Team"], ["settings", "Settings"]];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { org, member } = await requireSession();
  return (
    <div className="shell">
      <nav className="side">
        <b>{org.name}</b>
        {NAV.map(([h, l]) => <Link key={h} href={`/${h}`}>{l}</Link>)}
        <span style={{ flex: 1 }} />
        <span className="mut" style={{ padding: "0 12px", fontSize: 13 }}>{member.full_name ?? member.email}</span>
        <form action="/auth/signout" method="post"><button style={{ width: "100%" }}>Sign out</button></form>
      </nav>
      <main>{children}</main>
    </div>
  );
}
