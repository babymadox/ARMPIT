import type { ChannelAdapter } from "../types";

// TODO: implement the linkedin connection, webhook verification and send.
export const linkedin: ChannelAdapter = {
  kind: "linkedin",
  async beginConnect() { throw new Error("linkedin adapter not implemented yet"); },
  async parseWebhook() { throw new Error("linkedin adapter not implemented yet"); },
  async send() { throw new Error("linkedin adapter not implemented yet"); },
};
