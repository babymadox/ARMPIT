import type { ChannelAdapter } from "../types";

const no = () => { throw new Error("whatsapp is not set up yet"); };
// TODO: implement the whatsapp connection, webhook verification and send.
export const whatsapp: ChannelAdapter = { kind: "whatsapp", connect: no, disconnect: no, status: no, parseWebhook: no, send: no };
