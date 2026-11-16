/** Pure helpers for team invites (kept free of imports so they can be unit-tested). */
export type InviteError = "exists" | "rate_limited" | "failed";
export function classifyInviteError(message: string): InviteError {
  const m = message.toLowerCase();
  if (m.includes("already") && (m.includes("registered") || m.includes("exists"))) return "exists";   // the person already has an account
  if (m.includes("rate limit") || m.includes("too many") || m.includes("seconds")) return "rate_limited";
  return "failed";
}

/** Reads the tokens Supabase puts in the URL fragment of an invite or recovery link. */
export function parseAuthHash(hash: string) {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return { accessToken: p.get("access_token"), refreshToken: p.get("refresh_token"), type: p.get("type"), error: p.get("error_code") ?? p.get("error"), errorDescription: p.get("error_description") };
}
