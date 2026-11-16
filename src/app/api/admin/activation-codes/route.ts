import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateCode, hashCode } from "@/lib/activation";
import { logEvent } from "@/lib/log";

export const maxDuration = 30;

const authorised = (req: Request) => {
  const want = process.env.CRON_SECRET, got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Operator endpoint: issue activation codes. Only someone holding CRON_SECRET (set in Vercel, never in the repo) can call
 * it, so only the operator can create a code that create_organization() accepts.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
 *        -d '{"label":"Acme Co","count":1}' https://<site>/api/admin/activation-codes
 *
 * The plain code is returned once and never stored (only its hash is), exactly like an API key.
 */
export async function POST(req: Request) {
  if (!authorised(req)) return new NextResponse("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  const count = Math.min(50, Math.max(1, Math.floor(Number(body?.count)) || 1));
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 200) : null;
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = generateCode();
    const { error } = await supabaseAdmin().from("activation_codes").insert({ code_hash: hashCode(code), label });
    if (error) return NextResponse.json({ error: error.message.includes("does not exist") ? "Run migration 12 first (activation_codes table is missing)" : error.message, issued: codes }, { status: 500 });
    codes.push(code);
  }
  await logEvent({ level: "info", source: "admin.activation", message: `issued ${codes.length} activation code(s)` });   // never the codes themselves
  return NextResponse.json({ codes, note: "Shown once. Keep them safe: ARMPIT stores only a hash and cannot show them again." });
}

/** Lists issued codes with their status (never the codes). */
export async function GET(req: Request) {
  if (!authorised(req)) return new NextResponse("unauthorized", { status: 401 });
  const { data, error } = await supabaseAdmin().from("activation_codes").select("id,label,status,created_at,redeemed_at,org:organizations(name)").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ codes: data });
}

/** Revokes a code that has not been used yet (for example one that was leaked or sent to the wrong person). */
export async function PATCH(req: Request) {
  if (!authorised(req)) return new NextResponse("unauthorized", { status: 401 });
  const id = String((await req.json().catch(() => ({})))?.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("activation_codes").update({ status: "revoked" }).eq("id", id).eq("status", "issued").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ revoked: (data ?? []).length === 1, note: (data ?? []).length ? undefined : "No unused code with that id" });
}
