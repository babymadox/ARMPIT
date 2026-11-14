import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Evaluates enabled automations. Implemented: "no_message" -> create task. Others are TODO.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  const db = supabaseAdmin();
  const { data: autos = [] } = await db.from("automations").select("*").eq("enabled", true);
  let fired = 0;
  for (const a of autos!) {
    if (a.trigger?.type !== "no_message") continue;
    const cutoff = new Date(Date.now() - a.trigger.days * 864e5).toISOString();
    const { data: quiet = [] } = await db.from("conversations").select("partner_id,owner_id").eq("org_id", a.org_id).lt("last_message_at", cutoff).not("partner_id", "is", null);
    for (const c of quiet!) {
      // Avoid duplicates: one open task per partner per automation.
      const title = `${a.name}: follow up`;
      const { data: dup } = await db.from("tasks").select("id").eq("org_id", a.org_id).eq("partner_id", c.partner_id).eq("title", title).neq("status", "done").maybeSingle();
      if (dup) continue;
      await db.from("tasks").insert({ org_id: a.org_id, partner_id: c.partner_id, assignee_id: c.owner_id, title, category: "Follow-up" });
      fired++;
    }
    await db.from("automations").update({ runs: a.runs + fired, last_run_at: new Date().toISOString() }).eq("id", a.id);
  }
  return NextResponse.json({ fired });
}
