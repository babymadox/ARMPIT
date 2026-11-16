export const round2 = (n: number) => Math.round(n * 100) / 100;

export type PaymentFigures = { expected: number; tracker_amount: number | null; invoiced_amount: number | null };
/** Adjustments are signed lines on top of the deal's expected amount; tracker and invoice amounts stay untouched. */
export function summarise(p: PaymentFigures, adjustments: { amount: number | string }[]) {
  const adj = round2(adjustments.reduce((a, x) => a + Number(x.amount), 0));
  const adjusted = round2(Number(p.expected) + adj);
  return {
    adjustments: adj, adjusted,
    gap: p.tracker_amount == null ? null : round2(adjusted - Number(p.tracker_amount)),          // what the deal says minus what the tracker says
    invoiceGap: p.invoiced_amount == null ? null : round2(Number(p.invoiced_amount) - adjusted),   // what was invoiced minus what the deal says
  };
}

export type Decision = "pay_tracker" | "pay_expected" | "custom";
export function decide(d: Decision, s: { adjusted: number; tracker: number | null }, custom?: number | null, reason?: string): { ok: true; amount: number; note: string } | { ok: false; error: string } {
  const why = (reason ?? "").trim();
  if (d === "pay_tracker") return s.tracker == null ? { ok: false, error: "There is no tracker amount to pay" } : { ok: true, amount: round2(s.tracker), note: `Pay the tracker amount${why ? `: ${why}` : ""}` };
  if (d === "pay_expected") return { ok: true, amount: round2(s.adjusted), note: `Pay the amount the deal expects${why ? `: ${why}` : ""}` };
  if (custom == null || !Number.isFinite(custom) || custom < 0) return { ok: false, error: "Enter the amount to pay" };
  if (why.length < 5) return { ok: false, error: "Give a reason (at least 5 characters) for a custom amount" };
  return { ok: true, amount: round2(custom), note: `Pay a custom amount: ${why}` };
}
