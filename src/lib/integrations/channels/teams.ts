import type { ChannelAdapter } from "../types";

// TODO: implement the teams connection, webhook verification and send.
export const teams: ChannelAdapter = {
  kind: "teams",
  async beginConnect() { throw new Error("teams adapter not implemented yet"); },
  async parseWebhook() { throw new Error("teams adapter not implemented yet"); },
  async send() { throw new Error("teams adapter not implemented yet"); },
};
