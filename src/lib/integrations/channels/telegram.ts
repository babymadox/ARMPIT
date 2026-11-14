import type { ChannelAdapter } from "../types";

// TODO: implement the telegram connection, webhook verification and send.
export const telegram: ChannelAdapter = {
  kind: "telegram",
  async beginConnect() { throw new Error("telegram adapter not implemented yet"); },
  async parseWebhook() { throw new Error("telegram adapter not implemented yet"); },
  async send() { throw new Error("telegram adapter not implemented yet"); },
};
