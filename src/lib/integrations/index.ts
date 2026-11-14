import { cellxpert } from "./trackers/cellxpert"; import { affise } from "./trackers/affise"; import { affilka } from "./trackers/affilka";
import { voonix } from "./trackers/voonix"; import { appsflyer } from "./trackers/appsflyer";
import { telegram } from "./channels/telegram"; import { whatsapp } from "./channels/whatsapp"; import { teams } from "./channels/teams"; import { gmail } from "./channels/gmail";
export const trackers = { cellxpert, affise, affilka, voonix, appsflyer };
export const channels = { telegram, whatsapp, teams, gmail };
