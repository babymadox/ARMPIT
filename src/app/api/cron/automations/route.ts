import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Evaluates enabled automations (implemented: "no_message" -> follow-up task). Each automation is isolated; see runAutomations.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  try {
    const results = await runAutomations(supabaseAdmin());
    return NextResponse.json({ automations: results.length, fired: results.reduce((n, r) => n + r.fired, 0), results });
  } catch (e) { console.error("automations failed", e); return NextResponse.json({ error: "failed" }, { status: 500 }); }
}
