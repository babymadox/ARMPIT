import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { pollConnection } from "@/lib/mail";

export const maxDuration = 60;

/** Called by the open Inbox every ~90 seconds. Checks the caller's visible mailboxes (their own, or all for admins). */
export async function POST() {
  const { db, org } = await requireSession();
  const { data } = await db.from("channel_connections").select("id").eq("kind", "email").eq("status", "connected").limit(5);   // RLS: own mailboxes, or all for an admin
  let imported = 0, checked = 0; const errors: string[] = [];
  for (const c of data ?? []) {
    try { const r = await pollConnection({ orgId: org.id }, c.id, { minIntervalSec: 60 }); if (!r.skipped) checked++; imported += r.imported; }
    catch (e) { errors.push(e instanceof Error ? e.message : "failed"); }
  }
  return NextResponse.json({ imported, checked, errors });
}
