// Integration contracts. Each provider implements one of these; the app never talks to a provider directly.

/** externalId is the source; group is the agency/partner the source worked with (empty when the tracker has none). */
export type MetricRow = { externalId: string; group?: string; day: string; metric: string; value: number };

export interface TrackerAdapter {
  kind: "cellxpert" | "affise" | "affilka" | "voonix" | "appsflyer" | "singular";
  /** Verify credentials before saving them. */
  test(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  /** Affiliates visible in the tracker, to link to partners. */
  listAffiliates(creds: Record<string, string>): Promise<{ externalId: string; group?: string; name: string }[]>;
  /** Daily metrics as the tracker reports them. Never normalise or sum across trackers. */
  fetchStats(creds: Record<string, string>, from: string, to: string): Promise<MetricRow[]>;
}

export type InboundMessage = { externalConversationId: string; externalId: string; title?: string; sender: string; body: string; sentAt: string; attachments?: { name: string; kind: string }[] };
export type Creds = Record<string, string>;

export interface ChannelAdapter {
  kind: "telegram" | "whatsapp" | "teams" | "gmail" | "linkedin";
  /** Validate the credentials and register the provider's webhook. Returns the account label and the credentials to store (may add a webhook secret). */
  connect(creds: Creds, webhookUrl: string): Promise<{ account: string; creds: Creds }>;
  /** Remove the provider-side webhook. Best effort. */
  disconnect(creds: Creds): Promise<void>;
  /** Live health of the connection, for the Settings screen. */
  status(creds: Creds, webhookUrl: string): Promise<{ ok: boolean; detail: string }>;
  /** Verify and parse one webhook delivery. Throws on a bad signature. Returns [] for updates we ignore. */
  parseWebhook(req: Request, creds: Creds): Promise<InboundMessage[]>;
  send(creds: Creds, externalConversationId: string, body: string): Promise<{ externalId: string }>;
}
