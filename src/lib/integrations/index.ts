import { singular } from "./trackers/singular"; import { cellxpert } from "./trackers/cellxpert"; import { affise } from "./trackers/affise"; import { affilka } from "./trackers/affilka";
import { voonix } from "./trackers/voonix"; import { appsflyer } from "./trackers/appsflyer";
import { linkedin } from "./channels/linkedin"; import { telegram } from "./channels/telegram"; import { whatsapp } from "./channels/whatsapp"; import { teams } from "./channels/teams"; import { email } from "./channels/email.ts";
export const trackers = { singular, cellxpert, affise, affilka, voonix, appsflyer };
export const channels = { linkedin, telegram, whatsapp, teams, email };
