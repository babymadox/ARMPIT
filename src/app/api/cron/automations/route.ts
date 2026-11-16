import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/log";

export const maxDuration = 60;

// Evaluates enabled automations (implemented: "no_message" -> follow-up task). Each automation is isolated; see runAutomations.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  try {
    const results = await runAutomations(supabaseAdmin());
    const bad = results.filter((r) => r.error || r.skipped);
    await logEvent({ level: bad.length ? "warn" : "info", source: "cron.automations", message: `${results.length} automation(s), ${bad.length} skipped or failed`, details: { results: results.map((r) => ({ fired: r.fired, skipped: r.skipped, error: r.error })) } });
    return NextResponse.json({ automations: results.length, fired: results.reduce((n, r) => n + r.fired, 0), results });
  } catch (e) { await logEvent({ level: "error", source: "cron.automations", message: e instanceof Error ? e.message : "failed" }); return NextResponse.json({ error: "failed" }, { status: 500 }); }
}
