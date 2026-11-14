import { label } from "@/lib/format";
const C: Record<string, string> = { live: "#10b981", paid: "#10b981", confirmed: "#10b981", done: "#10b981", approved: "#3b82f6", open: "#3b82f6", in_progress: "#f59e0b",
  pending_approval: "#a855f7", waiting_for_approval: "#a855f7", difference: "#dc2626", disputed: "#dc2626", overdue: "#dc2626", blocked: "#dc2626" };
export function Chip({ v, color }: { v: string; color?: string }) {
  return <span className="chip" style={{ ["--c" as string]: color ?? C[v] ?? "#94a3b8" }}>{label(v)}</span>;
}
