import type { SupabaseClient } from "@supabase/supabase-js";

type Automation = { id: string; org_id: string; name: string; trigger: any; runs: number };
export type RunResult = { id: string; fired: number; skipped?: string; error?: string };

/** ISO cutoff for a "no_message" trigger, or null when the trigger is unsupported or malformed (never throws). */
export function cutoffFor(trigger: any, now = Date.now()): string | null {
  if (trigger?.type !== "no_message") return null;
  const days = Number(trigger.days);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now - days * 864e5).toISOString();
}

/**
 * Runs every enabled automation. Each automation is isolated: a bad trigger or a failing workspace is reported in the
 * result and never stops the others. `fired` is counted per automation.
 */
export async function runAutomations(db: SupabaseClient, now = Date.now()): Promise<RunResult[]> {
  const { data: autos, error } = await db.from("automations").select("*").eq("enabled", true);
  if (error) throw new Error(error.message);
  const results: RunResult[] = [];
  for (const a of (autos ?? []) as Automation[]) {
    try {
      const cutoff = cutoffFor(a.trigger, now);
      if (!cutoff) { results.push({ id: a.id, fired: 0, skipped: "unsupported or invalid trigger" }); continue; }
      const { data: quiet, error: e1 } = await db.from("conversations").select("partner_id,owner_id").eq("org_id", a.org_id).lt("last_message_at", cutoff).not("partner_id", "is", null);
      if (e1) throw new Error(e1.message);
      const title = `${a.name}: follow up`, seen = new Set<string>();
      let fired = 0;
      for (const c of quiet ?? []) {
        if (seen.has(c.partner_id)) continue;                 // several quiet chats of one partner -> one task
        seen.add(c.partner_id);
        const { data: open, error: e2 } = await db.from("tasks").select("id").eq("org_id", a.org_id).eq("partner_id", c.partner_id).eq("title", title).neq("status", "done").limit(1);
        if (e2) throw new Error(e2.message);
        if (open?.length) continue;                           // already has an open follow-up
        const { error: e3 } = await db.from("tasks").insert({ org_id: a.org_id, partner_id: c.partner_id, assignee_id: c.owner_id, title, category: "Follow-up" });
        if (e3) throw new Error(e3.message);
        fired++;
      }
      const { error: e4 } = await db.from("automations").update({ runs: a.runs + fired, last_run_at: new Date(now).toISOString() }).eq("id", a.id);
      if (e4) throw new Error(e4.message);
      results.push({ id: a.id, fired });
    } catch (e) { results.push({ id: a.id, fired: 0, error: e instanceof Error ? e.message : String(e) }); }
  }
  return results;
}
