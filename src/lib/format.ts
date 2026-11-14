const SYM: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
export const money = (v: number | null | undefined, cur = "USD") => v == null ? "—" : `${v < 0 ? "−" : ""}${SYM[cur] ?? "$"}${Math.abs(v).toLocaleString("en-US")}`;
export const label = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const date = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const ago = (d: string | null) => {
  if (!d) return "—"; const m = Math.round((Date.now() - +new Date(d)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
