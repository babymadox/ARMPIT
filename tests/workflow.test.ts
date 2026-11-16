import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAll } from "../src/lib/db.ts";
import { summarise, decide, round2 } from "../src/lib/payments.ts";
import { parse, dealSchema, adjustmentSchema, decisionSchema, inviteSchema, agentSchema } from "../src/lib/validation.ts";

const P = "11111111-1111-4111-8111-111111111111";

test("fetchAll pages past Supabase's 1000-row cap and never skips or repeats", async () => {
  const all = Array.from({ length: 2503 }, (_, i) => ({ id: i }));
  let calls = 0;
  const rows = await fetchAll<{ id: number }>(async (from, to) => { calls++; return { data: all.slice(from, to + 1), error: null }; });
  assert.equal(rows.length, 2503); assert.equal(calls, 3); assert.deepEqual(rows.map((r) => r.id), all.map((r) => r.id));
  assert.equal((await fetchAll<{ id: number }>(async () => ({ data: [], error: null }))).length, 0);
  const exact = await fetchAll<{ id: number }>(async (f, t) => ({ data: all.slice(0, 2000).slice(f, t + 1), error: null }));
  assert.equal(exact.length, 2000, "an exact multiple of the page size ends cleanly");
});
test("fetchAll surfaces errors and refuses runaway reads", async () => {
  await assert.rejects(fetchAll(async () => ({ data: null, error: { message: "boom" } })), /boom/);
  await assert.rejects(fetchAll(async () => ({ data: Array(10).fill({}), error: null }), 10, 30), /more than 30 rows/);
});

test("payment summary: adjustments change what the deal expects, not the tracker or invoice", () => {
  const s = summarise({ expected: 11500, tracker_amount: 10000, invoiced_amount: 10000 }, [{ amount: -500 }, { amount: "250.5" }]);
  assert.deepEqual(s, { adjustments: -249.5, adjusted: 11250.5, gap: 1250.5, invoiceGap: -1250.5 });
  assert.equal(summarise({ expected: 100, tracker_amount: null, invoiced_amount: null }, []).gap, null);
  assert.equal(round2(0.1 + 0.2), 0.3);
});
test("payment decisions", () => {
  const s = { adjusted: 11500, tracker: 10000 };
  assert.deepEqual(decide("pay_tracker", s), { ok: true, amount: 10000, note: "Pay the tracker amount" });
  assert.equal((decide("pay_expected", s, null, "contract says so") as any).amount, 11500);
  assert.equal((decide("pay_tracker", { adjusted: 5, tracker: null }) as any).ok, false);
  assert.equal((decide("custom", s, 10750, "split the difference") as any).amount, 10750);
  assert.match((decide("custom", s, 10750, "") as any).error, /reason/);
  assert.match((decide("custom", s, null, "reason here") as any).error, /amount/);
  assert.equal((decide("custom", s, -5, "reason here") as any).ok, false);
});

test("deal validation enforces the terms each deal type needs", () => {
  const base = { partner_id: P, brand: "LuckySpin", kind: "cpa", amount: "170", cap: "300", geos: "uk, ie ", currency: "EUR" };
  const ok = parse(dealSchema, base); assert.ok(ok.ok);
  if (ok.ok) { assert.deepEqual(ok.data.geos, ["UK", "IE"]); assert.equal(ok.data.amount, 170); assert.equal(ok.data.cap, 300); assert.equal(ok.data.submit, false); }
  assert.match((parse(dealSchema, { ...base, amount: "" }) as any).error, /amount: required for CPA/);
  assert.match((parse(dealSchema, { partner_id: P, brand: "B", kind: "revshare" }) as any).error, /rev_share_pct/);
  assert.match((parse(dealSchema, { partner_id: P, brand: "B", kind: "hybrid", amount: "10" }) as any).error, /rev_share_pct/);
  assert.match((parse(dealSchema, { ...base, rev_share_pct: "130" }) as any).error, /rev_share_pct/);
  assert.match((parse(dealSchema, { ...base, starts_on: "2026-12-01", ends_on: "2026-11-01" }) as any).error, /ends_on/);
  assert.match((parse(dealSchema, { ...base, partner_id: "nope" }) as any).error, /choose a partner/);
  assert.match((parse(dealSchema, { ...base, landing_url: "not a url" }) as any).error, /full URL/);
  assert.match((parse(dealSchema, { ...base, brand: "  " }) as any).error, /brand/);
  const fd = new FormData(); for (const [k, v] of Object.entries({ ...base, submit: "on" })) fd.set(k, v);
  const viaForm = parse(dealSchema, fd); assert.ok(viaForm.ok && viaForm.data.submit === true);
});
test("other inputs", () => {
  assert.ok(parse(adjustmentSchema, { amount: "-120", reason: "bonus missing" }).ok);
  assert.equal(parse(adjustmentSchema, { amount: "0", reason: "x y z" }).ok, false);
  assert.equal(parse(adjustmentSchema, { amount: "abc", reason: "valid reason" }).ok, false);
  assert.ok(parse(decisionSchema, { decision: "custom", custom_amount: "100", reason: "because" }).ok);
  assert.equal(parse(decisionSchema, { decision: "give_away" }).ok, false);
  const inv = parse(inviteSchema, { email: "  New.Person@Example.COM " }); assert.ok(inv.ok && inv.data.email === "new.person@example.com" && inv.data.role === "member");
  assert.equal(parse(inviteSchema, { email: "nope" }).ok, false);
  assert.equal(parse(inviteSchema, { email: "a@b.co", role: "owner_admin" }).ok, false, "invites cannot grant owner");
  assert.equal(parse(agentSchema, { question: "x" }).ok, false);
  assert.equal(parse(agentSchema, { question: "How is Viking Media doing?", history: Array(13).fill({ role: "user", content: "x" }) }).ok, false);
});

import { classifyInviteError, parseAuthHash } from "../src/lib/invite.ts";
import { fromTemplate } from "../src/lib/automation-templates.ts";
test("invite errors are classified so the admin gets the right message", () => {
  assert.equal(classifyInviteError("A user with this email address has already been registered"), "exists");
  assert.equal(classifyInviteError("email rate limit exceeded"), "rate_limited");
  assert.equal(classifyInviteError("For security purposes, you can only request this after 46 seconds."), "rate_limited");
  assert.equal(classifyInviteError("Error sending invite email"), "failed");
});
test("the invite link fragment is parsed, including expired links", () => {
  const ok = parseAuthHash("#access_token=AT&refresh_token=RT&expires_in=3600&type=invite");
  assert.deepEqual([ok.accessToken, ok.refreshToken, ok.type, ok.error], ["AT", "RT", "invite", null]);
  const bad = parseAuthHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(bad.error, "otp_expired"); assert.match(bad.errorDescription!, /invalid or has expired/); assert.equal(bad.accessToken, null);
  assert.equal(parseAuthHash("").accessToken, null);
});
test("automation templates use sensible defaults and clamp percentages", () => {
  assert.deepEqual(fromTemplate("silent_partner").trigger, { type: "no_message", days: 3 });
  assert.deepEqual(fromTemplate("silent_partner", 5).trigger, { type: "no_message", days: 5 });
  assert.equal((fromTemplate("cap_reached", 250).trigger as any).pct, 100); assert.equal((fromTemplate("cap_reached").trigger as any).pct, 90);
  assert.equal((fromTemplate("volume_drop", NaN).trigger as any).pct, 30); assert.equal((fromTemplate("no_reply", -2).trigger as any).days, 2);
});
