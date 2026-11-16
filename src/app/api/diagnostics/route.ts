import { NextResponse } from "next/server";
import { buildReport } from "@/lib/diagnostics";
import { toMarkdown } from "@/lib/report";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { timingSafeEqual } from "node:crypto";

export const maxDuration = 30;

const authorised = (req: Request) => {
  const want = process.env.CRON_SECRET, got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Operator endpoint: the same report as Settings -> Diagnostics, readable without a browser session.
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://<site>/api/diagnostics?format=md"
 * Includes system-wide (unscoped) events. Contains no secrets or message text.
 */
export async function GET(req: Request) {
  if (!authorised(req)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  let org = url.searchParams.get("org");
  if (!org) {
    const { data } = await supabaseAdmin().from("organizations").select("id,name");
    if (data?.length !== 1) return NextResponse.json({ error: "several workspaces: pass ?org=<id>", orgs: data }, { status: 400 });
    org = data[0].id;
  }
  if (!org) return NextResponse.json({ error: "no workspace" }, { status: 404 });
  const report = await buildReport(org, { origin: url.origin, includeSystem: true });
  return url.searchParams.get("format") === "json" ? NextResponse.json(report) : new NextResponse(toMarkdown(report), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
