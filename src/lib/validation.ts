import { z } from "zod";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optNum = (min = 0, max = Infinity) => z.preprocess((v) => (blank(v) === undefined ? undefined : Number(v)), z.number().finite().min(min).max(max).optional());
const optInt = (min = 1) => z.preprocess((v) => (blank(v) === undefined ? undefined : Number(v)), z.number().int().min(min).optional());
const optStr = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const date = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use a date").optional());

export const dealSchema = z.object({
  partner_id: z.string().uuid("choose a partner"),
  direction: z.enum(["out", "in"]).default("out"),
  brand: z.string().trim().min(1, "required").max(80),
  kind: z.enum(["cpa", "cpl", "revshare", "hybrid"]),
  amount: optNum(0), rev_share_pct: optNum(0, 100), cap: optInt(1),
  currency: z.enum(["USD", "EUR", "GBP"]).default("USD"),
  geos: z.preprocess((s) => (typeof s === "string" ? s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : s), z.array(z.string().max(8)).max(20)).default([]),
  metric: optStr(60), promo_code: optStr(40),
  landing_url: z.preprocess(blank, z.string().trim().url("must be a full URL such as https://…").max(300).optional()),
  starts_on: date, ends_on: date,
  submit: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(false),
}).superRefine((d, ctx) => {
  const need = (field: "amount" | "rev_share_pct", msg: string) => { if (d[field] == null) ctx.addIssue({ code: "custom", path: [field], message: msg }); };
  if (d.kind === "cpa" || d.kind === "cpl") need("amount", `required for ${d.kind.toUpperCase()}`);
  if (d.kind === "revshare") need("rev_share_pct", "required for a revenue share");
  if (d.kind === "hybrid") { need("amount", "required for a hybrid"); need("rev_share_pct", "required for a hybrid"); }
  if (d.starts_on && d.ends_on && d.ends_on < d.starts_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "must not be before the start date" });
});

export const adjustmentSchema = z.object({
  amount: z.preprocess((v) => Number(v), z.number().finite().refine((n) => n !== 0, "cannot be zero").refine((n) => Math.abs(n) < 1e9, "too large")),
  reason: z.string().trim().min(3, "give a reason").max(200),
});
export const invoiceSchema = z.object({
  invoiced_amount: z.preprocess((v) => Number(v), z.number().finite().min(0)),
  invoice_number: z.string().trim().min(1, "required").max(60),
});
export const decisionSchema = z.object({
  decision: z.enum(["pay_tracker", "pay_expected", "custom"]),
  custom_amount: optNum(0), reason: optStr(300),
});
export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email("enter a valid email").max(200), role: z.enum(["member", "admin"]).default("member") });
export const automationSchema = z.object({
  template: z.enum(["silent_partner", "no_reply", "cap_reached", "volume_drop"]),
  threshold: optNum(1, 365),
});
export const emailConnectSchema = z.object({
  email: z.string().trim().toLowerCase().email("enter the full email address").max(200),
  password: z.string().min(1, "enter the password").max(200),
  username: optStr(200), imap_host: optStr(200), smtp_host: optStr(200),
  imap_port: optInt(1), smtp_port: optInt(1),
}).superRefine((d, ctx) => {
  if (d.imap_port != null && ![993, 143].includes(d.imap_port)) ctx.addIssue({ code: "custom", path: ["imap_port"], message: "use 993 (or 143)" });
  if (d.smtp_port != null && ![465, 587].includes(d.smtp_port)) ctx.addIssue({ code: "custom", path: ["smtp_port"], message: "use 465 (or 587)" });
});
export const agentSchema = z.object({
  question: z.string().trim().min(2, "ask a question").max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12).default([]),
});

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };
/** Parses form (or plain) input and returns one readable error line instead of throwing. */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): Parsed<z.output<T>> {
  const src = input instanceof FormData ? Object.fromEntries(input.entries()) : input;
  const r = schema.safeParse(src);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
}
