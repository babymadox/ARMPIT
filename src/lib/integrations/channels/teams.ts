import type { ChannelAdapter } from "../types";

const no = () => { throw new Error("teams is not set up yet"); };
// TODO: implement the teams connection, webhook verification and send.
export const teams: ChannelAdapter = { kind: "teams", connect: no, disconnect: no, status: no, parseWebhook: no, send: no };
