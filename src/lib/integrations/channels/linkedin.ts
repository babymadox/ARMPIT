import type { ChannelAdapter } from "../types";

const no = () => { throw new Error("linkedin is not set up yet"); };
// TODO: implement the linkedin connection, webhook verification and send.
export const linkedin: ChannelAdapter = { kind: "linkedin", connect: no, disconnect: no, status: no, parseWebhook: no, send: no };
