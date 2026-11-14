import type { ChannelAdapter } from "../types";

// TODO: implement the gmail connection, webhook verification and send.
export const gmail: ChannelAdapter = {
  kind: "gmail",
  async beginConnect() { throw new Error("gmail adapter not implemented yet"); },
  async parseWebhook() { throw new Error("gmail adapter not implemented yet"); },
  async send() { throw new Error("gmail adapter not implemented yet"); },
};
