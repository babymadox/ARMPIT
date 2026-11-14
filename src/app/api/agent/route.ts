import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

// "Ask the agent": answers questions about the caller's own partners and numbers.
// Reads go through the user's RLS-scoped client, so the agent can never see more than the user can.
export async function POST(req: Request) {
  const { db, org } = await requireSession();
  const { question } = await req.json();
  if (!question || typeof question !== "string") return NextResponse.json({ error: "question required" }, { status: 400 });

  const [{ data: payments }, { data: deals }, { data: tasks }] = await Promise.all([
    db.from("payments").select("status,expected,tracker_amount,blocker,partner:partners(name)").in("status", ["difference", "disputed", "overdue"]).limit(25),
    db.from("deals").select("brand,kind,status,cap,progress,partner:partners(name)").eq("status", "live").limit(25),
    db.from("tasks").select("title,status,due_on").neq("status", "done").limit(25),
  ]);
  const context = JSON.stringify({ org: org.name, payments, deals, tasks });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5", max_tokens: 800,
      system: "You are ARMPIT's assistant for affiliate managers. Answer only from the JSON context. If it is not there, say you don't have it. Never take actions; only suggest them.",
      messages: [{ role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` }],
    }),
  });
  if (!r.ok) return NextResponse.json({ error: "agent unavailable" }, { status: 502 });
  const j = await r.json();
  return NextResponse.json({ answer: j.content?.[0]?.text ?? "" });
}
