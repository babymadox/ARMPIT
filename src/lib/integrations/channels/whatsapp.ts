import type { ChannelAdapter } from "../types";

// TODO: implement the whatsapp connection, webhook verification and send.
export const whatsapp: ChannelAdapter = {
  kind: "whatsapp",
  async beginConnect() { throw new Error("whatsapp adapter not implemented yet"); },
  async parseWebhook() { throw new Error("whatsapp adapter not implemented yet"); },
  async send() { throw new Error("whatsapp adapter not implemented yet"); },
};
