import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { parse, agentSchema } from "@/lib/validation";
import { logEvent, errMsg } from "@/lib/log";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const HOURLY_LIMIT = 60;   // per workspace: a cost guard, not a security boundary

/**
 * "Ask ARMPIT": answers questions about the caller's own workspace. Reads go through the user's RLS-scoped client, so the
 * agent can never see more than the user can. It only reads and suggests; it takes no actions.
 */
export async function POST(req: Request) {
  const { db, org } = await requireSession();
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "The AI agent is not set up yet. An admin needs to add ANTHROPIC_API_KEY in Vercel and redeploy." }, { status: 503 });
  const r = parse(agentSchema, await req.json().catch(() => null));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await supabaseAdmin().from("app_events").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("source", "agent").gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) return NextResponse.json({ error: "Hourly question limit reached for this workspace. Try again later." }, { status: 429 });

  const day = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const [pay, deals, tasks, unread, cur, prev, partners] = await Promise.all([
    db.from("payments").select("status,expected,tracker_amount,blocker,currency,partner:partners(name)").in("status", ["difference", "disputed", "overdue", "waiting_for_invoice"]).limit(25),
    db.from("deals").select("brand,kind,status,cap,progress,partner:partners(name)").in("status", ["live", "pending_approval"]).limit(25),
    db.from("tasks").select("title,status,priority,due_on,partner:partners(name)").neq("status", "done").order("due_on").limit(25),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("unread", true),
    db.rpc("partner_metric_sums", { p_org: org.id, p_metric: "custom_installs", p_from: day(7), p_to: day(1) }),
    db.rpc("partner_metric_sums", { p_org: org.id, p_metric: "custom_installs", p_from: day(14), p_to: day(8) }),
    db.from("partners").select("id,name").limit(1000),
  ]);
  const names = new Map((partners.data ?? []).map((p: any) => [p.id, p.name]));
  const prevMap = new Map(((prev.data ?? []) as any[]).map((x) => [x.partner_id, Number(x.total)]));
  const installs = ((cur.data ?? []) as any[]).sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 15).map((x) => ({ partner: names.get(x.partner_id), installs_last_7d: Number(x.total), installs_previous_7d: prevMap.get(x.partner_id) ?? 0 }));
  const context = JSON.stringify({ workspace: org.name, today: day(0), unread_chats: unread.count ?? 0, payments_needing_attention: pay.data, deals_live_or_pending: deals.data, open_tasks: tasks.data, top_partners_by_installs: installs });

  const t0 = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(45_000),
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 800,
        system: "You are ARMPIT's assistant for affiliate managers. Answer only from the JSON context in the first message. If something is not in the context, say you do not have it; never invent numbers or names. You cannot take actions: suggest next steps instead. Be concise and specific, and name partners.",
        messages: [{ role: "user", content: `Workspace data (JSON):\n${context}\n\nUse it to answer my questions.` }, { role: "assistant", content: "Understood. I will answer only from that data." }, ...r.data.history.slice(-6), { role: "user", content: r.data.question }],
      }),
    });
    if (!res.ok) { await logEvent({ orgId: org.id, level: "warn", source: "agent", message: `model request failed (${res.status})`, details: { ms: Date.now() - t0 } }); return NextResponse.json({ error: res.status === 401 ? "The AI key was rejected. Check ANTHROPIC_API_KEY." : "The AI service could not answer right now." }, { status: 502 }); }
    const j: any = await res.json();
    const answer = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    await logEvent({ orgId: org.id, level: "info", source: "agent", message: "answered", details: { ms: Date.now() - t0, question_chars: r.data.question.length, answer_chars: answer.length } });   // lengths only: never the question or answer text
    return NextResponse.json({ answer: answer || "I could not produce an answer." });
  } catch (e) {
    await logEvent({ orgId: org.id, level: "warn", source: "agent", message: `model request error: ${errMsg(e)}`, details: { ms: Date.now() - t0 } });
    return NextResponse.json({ error: (e as Error)?.name === "TimeoutError" ? "The AI service took too long. Try again." : "The AI service could not be reached." }, { status: 502 });
  }
}
