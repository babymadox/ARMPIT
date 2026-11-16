import nodemailer from "nodemailer";
import { resolvePublic, type Target } from "./net.ts";
import { explainMailError, type MailCreds } from "./imap.ts";

export type Mail = { to: string; subject: string; text: string; inReplyTo?: string | null; references?: string[] };
export type SmtpDeps = { resolve?: (host: string) => Promise<Target>; ignoreTLS?: boolean };
const ADDRESS = /^[^\s@<>",;:\\]+@[^\s@<>",;:\\]+\.[^\s@<>",;:\\]+$/;
export const isMailbox = (a: string) => ADDRESS.test(a) && a.length <= 254;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function transport(creds: MailCreds, t: Target, d: SmtpDeps) {
  const port = Number(creds.smtp_port || 465);
  return nodemailer.createTransport({ host: t.ip, port, secure: port === 465, requireTLS: port === 587 && !d.ignoreTLS, ignoreTLS: d.ignoreTLS, auth: { user: creds.username || creds.email, pass: creds.password },
    tls: { servername: t.servername, rejectUnauthorized: !d.ignoreTLS }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
}
const target = (creds: MailCreds, d: SmtpDeps) => (d.resolve ?? ((h) => resolvePublic(h)))(creds.smtp_host);

/** Checks the outgoing server accepts the address and password, without sending anything. */
export async function verifySmtp(creds: MailCreds, d: SmtpDeps = {}) {
  try { await transport(creds, await target(creds, d), d).verify(); } catch (e) { throw new Error(explainMailError(e, "outgoing (SMTP)", creds.smtp_host)); }
}

export async function sendMail(creds: MailCreds, mail: Mail, d: SmtpDeps = {}): Promise<{ messageId: string }> {
  if (!isMailbox(mail.to)) throw new Error("That is not a valid email address");           // also blocks header injection (no CR/LF, commas or quotes)
  const name = oneLine(creds.name ?? "").replace(/["<>]/g, "");
  try {
    const info = await transport(creds, await target(creds, d), d).sendMail({
      from: name ? { name, address: creds.email } : creds.email, to: mail.to, subject: oneLine(mail.subject).slice(0, 200), text: mail.text,
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: mail.references?.length ? mail.references : [mail.inReplyTo] } : {}),
    });
    return { messageId: String(info.messageId) };
  } catch (e) { throw new Error(explainMailError(e, "outgoing (SMTP)", creds.smtp_host)); }
}
