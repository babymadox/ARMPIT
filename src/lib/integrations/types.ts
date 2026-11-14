// Integration contracts. Each provider implements one of these; the app never talks to a provider directly.

export type MetricRow = { externalId: string; day: string; metric: string; value: number };

export interface TrackerAdapter {
  kind: "cellxpert" | "affise" | "affilka" | "voonix" | "appsflyer";
  /** Verify credentials before saving them. */
  test(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  /** Affiliates visible in the tracker, to link to partners. */
  listAffiliates(creds: Record<string, string>): Promise<{ externalId: string; name: string }[]>;
  /** Daily metrics as the tracker reports them. Never normalise or sum across trackers. */
  fetchStats(creds: Record<string, string>, from: string, to: string): Promise<MetricRow[]>;
}

export type InboundMessage = { externalConversationId: string; externalId: string; title?: string; sender: string; body: string; sentAt: string; attachments?: { name: string; url: string }[] };

export interface ChannelAdapter {
  kind: "telegram" | "whatsapp" | "teams" | "gmail";
  /** Start the provider's connect/OAuth flow and return the URL (or QR payload) to show the user. */
  beginConnect(memberId: string): Promise<{ url?: string; qr?: string }>;
  /** Parse and verify a webhook delivery. Throws on a bad signature. */
  parseWebhook(req: Request): Promise<InboundMessage[]>;
  send(creds: Record<string, string>, externalConversationId: string, body: string): Promise<{ externalId: string }>;
}
