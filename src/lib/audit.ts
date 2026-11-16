import { supabaseAdmin } from "./supabase/admin";
import { scrubDetails, errMsg } from "./scrub.ts";
import { logEvent } from "./log";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records who did what in the workspace (admin-readable audit log). Never throws: a failed audit write is logged as a
 * warning but must not undo or block the action it describes. Details are scrubbed: no secrets, no message text.
 */
export async function audit(e: { orgId: string; actorId?: string | null; action: string; entity?: string; entityId?: string | null; meta?: unknown }): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("audit_log").insert({
      org_id: e.orgId, actor_id: e.actorId ?? null, action: e.action.slice(0, 80), entity: e.entity?.slice(0, 40) ?? null,
      entity_id: e.entityId && UUID.test(e.entityId) ? e.entityId : null, meta: e.meta === undefined ? null : scrubDetails(e.meta),
    });
    if (error) await logEvent({ orgId: e.orgId, level: "warn", source: "audit", message: `audit write failed: ${errMsg(error.message)}`, details: { action: e.action } });
  } catch (err) { await logEvent({ orgId: e.orgId, level: "warn", source: "audit", message: `audit write failed: ${errMsg(err)}`, details: { action: e.action } }); }
}
