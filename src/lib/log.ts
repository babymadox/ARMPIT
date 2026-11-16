import { supabaseAdmin } from "./supabase/admin";
import { buildEventRow, type EventInput } from "./scrub.ts";
export { errMsg } from "./scrub.ts";

/**
 * Records an event in app_events (and the Vercel log). Never throws and never blocks the caller on failure:
 * logging must not be able to break a request. Secrets and message text are removed by buildEventRow.
 */
export async function logEvent(e: EventInput): Promise<void> {
  const row = buildEventRow(e);
  const line = `[armpit] ${row.level} ${row.source}: ${row.message}${row.digest ? ` digest=${row.digest}` : ""}`;
  (row.level === "error" ? console.error : row.level === "warn" ? console.warn : console.log)(line);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    const { error } = await supabaseAdmin().from("app_events").insert(row);
    if (error) console.error("[armpit] event not stored:", error.message);       // e.g. migration 9 not applied
  } catch (err) { console.error("[armpit] event not stored:", err instanceof Error ? err.message : "unknown"); }
}
