import type { ChannelAdapter } from "../types";

const no = () => { throw new Error("gmail is not set up yet"); };
// TODO: implement the gmail connection, webhook verification and send.
export const gmail: ChannelAdapter = { kind: "gmail", connect: no, disconnect: no, status: no, parseWebhook: no, send: no };
