import type { ReactNode } from "react";

const ICONS: Record<string, string> = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z",
  overview: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  partners: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  deals: "M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z",
  payments: "M2 5h20v14H2zM2 10h20",
  automations: "M13 2 3 14h9l-1 8 10-12h-9z",
  team: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM3 22a9 9 0 0 1 18 0",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  check: "M20 6 9 17l-5-5",
};
export const Icon = ({ name, size = 18 }: { name: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] ?? ICONS.check} /></svg>
);

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="phead"><div><h1>{title}</h1>{sub && <p className="mut">{sub}</p>}</div>{actions && <div className="toolbar" style={{ margin: 0 }}>{actions}</div>}</header>
  );
}

export function Stat({ label, value, icon, tone = "brand", href }: { label: string; value: ReactNode; icon: string; tone?: "brand" | "warn" | "ok"; href?: string }) {
  const inner = (<><span className={`stat-ic ${tone}`}><Icon name={icon} /></span><div><div className="stat-v">{value}</div><div className="mut">{label}</div></div></>);
  return href ? <a className="card stat-card hover" href={href}>{inner}</a> : <div className="card stat-card">{inner}</div>;
}

const HUES = [262, 217, 160, 32, 340, 190, 280, 120];
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const h = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return <span className="avatar" style={{ width: size, height: size, background: `hsl(${h} 70% 92%)`, color: `hsl(${h} 55% 35%)`, fontSize: size * 0.38 }}>{ini}</span>;
}

export function Empty({ icon = "chat", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return <div className="empty"><span className="stat-ic brand"><Icon name={icon} size={22} /></span><b>{title}</b>{children && <p>{children}</p>}</div>;
}
