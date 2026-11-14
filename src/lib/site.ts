import { headers } from "next/headers";

/** Public origin of this deployment, from the incoming request (works on Vercel and behind proxies). */
export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
export const webhookUrl = (origin: string, channel: string, connectionId: string) => `${origin}/api/webhooks/${channel}?c=${connectionId}`;
