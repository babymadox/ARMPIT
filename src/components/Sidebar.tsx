"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

const NAV = [["inbox", "Inbox"], ["overview", "Overview"], ["partners", "Partners"], ["deals", "Deals"], ["payments", "Payments"], ["automations", "Automations"], ["agent", "Ask ARMPIT"], ["notifications", "Notifications"], ["team", "Team"], ["settings", "Settings"]];

export function Sidebar({ org, user, unread = 0 }: { org: string; user: string; unread?: number }) {
  const path = usePathname();
  return (
    <nav className="side" aria-label="Main">
      <div className="brand"><span className="logo">A</span><div><b>ARMPIT</b><small>{org}</small></div></div>
      <div className="navlist">{NAV.map(([h, l]) => (
        <Link key={h} href={`/${h}`} className={path.startsWith(`/${h}`) ? "on" : ""} aria-current={path.startsWith(`/${h}`) ? "page" : undefined}><Icon name={h} />{l}{h === "notifications" && unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>}</Link>))}</div>
      <div className="me"><span className="avatar" style={{ width: 32, height: 32, background: "rgba(255,255,255,.14)", color: "#fff", fontSize: 12 }}>{user.slice(0, 2).toUpperCase()}</span>
        <span className="who">{user}</span>
        <form action="/auth/signout" method="post"><button className="ghost" title="Sign out">Sign out</button></form></div>
    </nav>
  );
}
