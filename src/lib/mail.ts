import { channels } from "./integrations";
import { readCreds } from "./secrets";
import { supabaseAdmin } from "./supabase/admin";
import { ingestMessages } from "./inbox";
import { errMsg, logEvent } from "./log";
import type { Scope } from "./sync";

export type PollOutcome = { imported: number; skipped?: string; stats?: Record<string, number> };

/**
 * Checks one mailbox for new mail and stores it as conversations. Safe to call from several places at once (open tabs,
 * the daily job): a claim on `last_polled_at` lets only one caller poll within `minIntervalSec`, and storing is idempotent.
 * A rejected password marks the connection "error" and stops background polling until someone presses Check now.
 */
export async function pollConnection(scope: Scope, connectionId: string, opts: { minIntervalSec?: number; force?: boolean } = {}): Promise<PollOutcome> {
  const db = supabaseAdmin();
  const { data: c } = await db.from("channel_connections").select("id,org_id,member_id,vault_secret_id,sync_state,status").eq("id", connectionId).eq("kind", "email").maybeSingle();
  if (!c || (scope !== "all-orgs" && c.org_id !== scope.orgId)) throw new Error("Mailbox not found");
  if (c.status === "error" && !opts.force) return { imported: 0, skipped: "sign-in failed: press Check now after fixing the password" };

  const now = Date.now(), cutoff = new Date(now - (opts.minIntervalSec ?? 60) * 1000).toISOString();
  const { data: claimed, error: claimErr } = await db.from("channel_connections").update({ last_polled_at: new Date(now).toISOString() }).eq("id", c.id).or(`last_polled_at.is.null,last_polled_at.lt.${cutoff}`).select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return { imported: 0, skipped: "checked moments ago" };

  try {
    const r = await channels.email.poll!(await readCreds(c.vault_secret_id, c.org_id), c.sync_state);
    const stored = await ingestMessages(db, { id: c.id, org_id: c.org_id, member_id: c.member_id, kind: "email" }, r.messages);
    const { error: upErr } = await db.from("channel_connections").update({ sync_state: r.state as object, last_error: null, status: "connected" }).eq("id", c.id);
    if (upErr) throw new Error(upErr.message);
    if (stored > 0 || r.stats.failed > 0) await logEvent({ orgId: c.org_id, level: r.stats.failed ? "warn" : "info", source: "mail.poll", message: `${stored} new message(s)`, details: r.stats });
    return { imported: stored, stats: r.stats };
  } catch (e) {
    const msg = errMsg(e), authFailed = /rejected the sign-in/.test(msg);
    await db.from("channel_connections").update({ last_error: msg.slice(0, 300), ...(authFailed ? { status: "error" } : {}) }).eq("id", c.id); // best effort: the thrown error below is what the caller sees
    await logEvent({ orgId: c.org_id, level: "warn", source: "mail.poll", message: msg });
    throw new Error(msg);
  }
}
