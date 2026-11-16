import type { SupabaseClient } from "@supabase/supabase-js";

type Automation = { id: string; org_id: string; name: string; trigger: any; actions: any[] | null; runs: number };
export type RunResult = { id: string; fired: number; skipped?: string; error?: string };
/** Something an automation noticed. `key` identifies it for de-duplication. */
export type Hit = { key: string; partnerId: string | null; ownerId: string | null; title: string; body: string; href: string };

const DAY = 864e5;
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** ISO week label, e.g. 2026-W46: a condition that persists re-notifies at most once a week. */
export function weekKey(now: number) {
  const d = new Date(now), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((+t - +y0) / DAY + 1) / 7)}`;
}

/** ISO cutoff for the "days" based triggers, or null when the trigger is unsupported or malformed (never throws). */
export function cutoffFor(trigger: any, now = Date.now()): string | null {
  if (trigger?.type !== "no_message" && trigger?.type !== "no_reply") return null;
  const days = Number(trigger.days);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now - days * DAY).toISOString();
}

const METRIC_LABEL: Record<string, string> = { custom_installs: "Installs", custom_clicks: "Clicks", tracker_reengagements: "Re-engagements", adn_cost: "Cost" };
export function humanize(trigger: any): string {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : "?");
  switch (trigger?.type) {
    case "no_message": return `No message from the partner for ${n(trigger.days)} days`;
    case "no_reply": return `No reply to our last message for ${n(trigger.days)} days`;
    case "cap_pct": return `A live deal reaches ${n(trigger.pct)}% of its cap`;
    case "metric_drop": return `${METRIC_LABEL[trigger.metric ?? "custom_installs"] ?? trigger.metric} falls ${n(trigger.pct)}% against the previous ${n(trigger.days ?? 7)} days`;
    default: return "Custom trigger";
  }
}

// ---------- pure evaluators: data in, hits out ----------
type Conv = { id?: string; title?: string | null; partner_id: string | null; owner_id: string | null; last_inbound_at: string | null; created_at: string; last_message_at: string | null; last_direction?: string | null };

/** A partner is silent when NONE of its chats has heard from the partner since the cutoff. */
export function silentPartners(convs: Conv[], cutoff: string, name: string): Hit[] {
  const by = new Map<string, Conv[]>();
  for (const c of convs) if (c.partner_id) (by.get(c.partner_id) ?? by.set(c.partner_id, []).get(c.partner_id)!).push(c);
  const hits: Hit[] = [];
  for (const [pid, cs] of by) {
    const heard = cs.map((c) => c.last_inbound_at ?? c.created_at).sort().at(-1)!;
    if (heard >= cutoff) continue;
    const owner = [...cs].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0].owner_id;
    hits.push({ key: `silent:${pid}`, partnerId: pid, ownerId: owner, title: `${name}: follow up`, body: `Nothing from this partner since ${heard.slice(0, 10)}`, href: `/partners/${pid}` });
  }
  return hits;
}
export function noReplyChats(convs: Conv[], cutoff: string): Hit[] {
  return convs.filter((c) => c.last_direction === "out" && c.last_message_at && c.last_message_at < cutoff).map((c) => ({
    key: `noreply:${c.id}`, partnerId: c.partner_id, ownerId: c.owner_id, title: `No reply from ${c.title ?? "a chat"}`, body: `Our last message on ${c.last_message_at!.slice(0, 10)} is unanswered`, href: `/inbox?c=${c.id}`,
  }));
}
export function capHits(deals: { id: string; partner_id: string; owner_id: string | null; brand: string | null; cap: number | null; progress: number | null; status: string }[], pct: number): Hit[] {
  return deals.filter((d) => d.status === "live" && d.cap && d.cap > 0 && ((d.progress ?? 0) / d.cap) * 100 >= pct).map((d) => ({
    key: `cap:${d.id}`, partnerId: d.partner_id, ownerId: d.owner_id, title: `Deal cap almost reached: ${d.brand ?? "deal"}`, body: `${d.progress ?? 0} of ${d.cap} used (${Math.round(((d.progress ?? 0) / d.cap!) * 100)}%)`, href: "/deals",
  }));
}
export function dropHits(cur: Map<string, number>, prev: Map<string, number>, pct: number, minPrev: number, partners: Map<string, { owner: string | null; name: string }>, metric: string, days: number): Hit[] {
  const hits: Hit[] = [];
  for (const [pid, before] of prev) {
    if (before < minPrev) continue;                           // too little volume to judge a drop
    const now = cur.get(pid) ?? 0, drop = ((before - now) / before) * 100;
    if (drop < pct) continue;
    const p = partners.get(pid);
    hits.push({ key: `drop:${pid}`, partnerId: pid, ownerId: p?.owner ?? null, title: `Volume drop: ${p?.name ?? "partner"}`, body: `${METRIC_LABEL[metric] ?? metric} ${Math.round(now)} vs ${Math.round(before)} in the previous ${days} days (−${Math.round(drop)}%)`, href: `/partners/${pid}` });
  }
  return hits;
}

// ---------- running ----------
async function collect(db: SupabaseClient, a: Automation, now: number): Promise<Hit[] | null> {
  const t = a.trigger, org = a.org_id;
  const must = <T,>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as T; };
  if (t?.type === "no_message" || t?.type === "no_reply") {
    const cutoff = cutoffFor(t, now); if (!cutoff) return null;
    const convs = must(await db.from("conversations").select("id,title,partner_id,owner_id,last_inbound_at,created_at,last_message_at,last_direction").eq("org_id", org).limit(1000)) as Conv[];
    return t.type === "no_message" ? silentPartners(convs, cutoff, a.name) : noReplyChats(convs, cutoff);
  }
  if (t?.type === "cap_pct") {
    const pct = Number(t.pct); if (!Number.isFinite(pct) || pct <= 0) return null;
    return capHits(must(await db.from("deals").select("id,partner_id,owner_id,brand,cap,progress,status").eq("org_id", org).eq("status", "live").limit(1000)) as any[], pct);
  }
  if (t?.type === "metric_drop") {
    const pct = Number(t.pct), days = Number(t.days ?? 7), minPrev = Number(t.min_prev ?? 20), metric = String(t.metric ?? "custom_installs");
    if (![pct, days, minPrev].every(Number.isFinite) || pct <= 0 || days <= 0) return null;
    const today = now - DAY;   // yesterday is the last complete day
    const [curR, prevR, parts] = await Promise.all([
      db.rpc("partner_metric_sums", { p_org: org, p_metric: metric, p_from: isoDay(today - (days - 1) * DAY), p_to: isoDay(today) }),
      db.rpc("partner_metric_sums", { p_org: org, p_metric: metric, p_from: isoDay(today - (2 * days - 1) * DAY), p_to: isoDay(today - days * DAY) }),
      db.from("partners").select("id,name,owner_id").eq("org_id", org).limit(1000),
    ]);
    const toMap = (rows: any[]) => new Map(rows.map((r) => [r.partner_id, Number(r.total)] as [string, number]));
    const names = new Map((must(parts) as any[]).map((p) => [p.id, { owner: p.owner_id, name: p.name }] as [string, { owner: string | null; name: string }]));
    return dropHits(toMap(must(curR) as any[]), toMap(must(prevR) as any[]), pct, minPrev, names, metric, days);
  }
  return null;
}

/** Inserts a notification once per (recipient, key). Returns true only when a NEW one was created. */
async function notifyOnce(db: SupabaseClient, row: { org_id: string; member_id: string; title: string; body: string; href: string; dedupe_key: string }) {
  const { data, error } = await db.from("notifications").upsert(row, { onConflict: "member_id,dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(error.message);
  return !!data?.length;
}

/**
 * Runs enabled automations (all workspaces, or one with opts.orgId). Each automation is isolated: a bad trigger or a
 * failing workspace is reported in the result and never stops the others. `fired` counts hits that had a NEW effect.
 */
export async function runAutomations(db: SupabaseClient, now = Date.now(), opts: { orgId?: string } = {}): Promise<RunResult[]> {
  let q = db.from("automations").select("*").eq("enabled", true);
  if (opts.orgId) q = q.eq("org_id", opts.orgId);
  const { data: autos, error } = await q;
  if (error) throw new Error(error.message);
  const results: RunResult[] = [];
  const adminCache = new Map<string, string[]>();
  const admins = async (org: string) => {
    if (!adminCache.has(org)) { const { data } = await db.from("members").select("id").eq("org_id", org).eq("status", "active").in("role", ["owner_admin", "admin"]); adminCache.set(org, (data ?? []).map((m: any) => m.id)); }
    return adminCache.get(org)!;
  };
  for (const a of (autos ?? []) as Automation[]) {
    try {
      const hits = await collect(db, a, now);
      if (!hits) { results.push({ id: a.id, fired: 0, skipped: "unsupported or invalid trigger" }); continue; }
      const actions = a.actions?.length ? a.actions : [{ type: "notify", who: "owner" }];
      let fired = 0;
      for (const h of hits) {
        let effect = false;
        for (const act of actions) {
          if (act.type === "create_task" && h.partnerId) {
            const { data: open, error: e2 } = await db.from("tasks").select("id").eq("org_id", a.org_id).eq("partner_id", h.partnerId).eq("title", h.title).neq("status", "done").limit(1);
            if (e2) throw new Error(e2.message);
            if (!open?.length) { const { error: e3 } = await db.from("tasks").insert({ org_id: a.org_id, partner_id: h.partnerId, assignee_id: h.ownerId, title: h.title, category: "Follow-up" }); if (e3) throw new Error(e3.message); effect = true; }
          } else if (act.type === "notify") {
            const to = act.who === "admins" || !h.ownerId ? await admins(a.org_id) : [h.ownerId];
            for (const member of to) if (await notifyOnce(db, { org_id: a.org_id, member_id: member, title: h.title, body: h.body, href: h.href, dedupe_key: `auto:${a.id}:${h.key}:${weekKey(now)}` })) effect = true;
          }
        }
        if (effect) fired++;
      }
      const { error: e4 } = await db.from("automations").update({ runs: a.runs + fired, last_run_at: new Date(now).toISOString() }).eq("id", a.id);
      if (e4) throw new Error(e4.message);
      results.push({ id: a.id, fired });
    } catch (e) { results.push({ id: a.id, fired: 0, error: e instanceof Error ? e.message : String(e) }); }
  }
  return results;
}
