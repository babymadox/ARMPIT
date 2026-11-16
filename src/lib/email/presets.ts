/** Mail server settings for common providers, detected from the address. Anything else gets sensible guesses the user can edit. */
export type Server = { host: string; port: number };
export type Preset = { id: string; label: string; imap: Server; smtp: Server; hint: string };

const P: Record<string, Preset> = {
  gmail: { id: "gmail", label: "Gmail / Google Workspace", imap: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465 },
    hint: "Turn on 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords and use that instead of your normal password." },
  outlook: { id: "outlook", label: "Outlook / Hotmail / Microsoft 365", imap: { host: "outlook.office365.com", port: 993 }, smtp: { host: "smtp.office365.com", port: 587 },
    hint: "Needs an app password. Many Microsoft 365 company tenants have turned password sign-in for IMAP off, and then this cannot connect." },
  yahoo: { id: "yahoo", label: "Yahoo Mail", imap: { host: "imap.mail.yahoo.com", port: 993 }, smtp: { host: "smtp.mail.yahoo.com", port: 465 }, hint: "Create an app password in Yahoo Account Security." },
  icloud: { id: "icloud", label: "iCloud Mail", imap: { host: "imap.mail.me.com", port: 993 }, smtp: { host: "smtp.mail.me.com", port: 587 }, hint: "Create an app-specific password at appleid.apple.com." },
  zoho: { id: "zoho", label: "Zoho Mail", imap: { host: "imap.zoho.com", port: 993 }, smtp: { host: "smtp.zoho.com", port: 465 }, hint: "Use an application-specific password." },
  fastmail: { id: "fastmail", label: "Fastmail", imap: { host: "imap.fastmail.com", port: 993 }, smtp: { host: "smtp.fastmail.com", port: 465 }, hint: "Create an app password with IMAP and SMTP access." },
};
const BY_DOMAIN: Record<string, string> = {
  "gmail.com": "gmail", "googlemail.com": "gmail", "outlook.com": "outlook", "hotmail.com": "outlook", "live.com": "outlook", "msn.com": "outlook", "office365.com": "outlook",
  "yahoo.com": "yahoo", "ymail.com": "yahoo", "icloud.com": "icloud", "me.com": "icloud", "mac.com": "icloud", "zoho.com": "zoho", "zohomail.com": "zoho", "fastmail.com": "fastmail", "fastmail.fm": "fastmail",
};

export const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";
export function detectProvider(email: string): Preset {
  const d = domainOf(email), known = BY_DOMAIN[d];
  if (known) return P[known];
  return { id: "custom", label: d ? `Your own mail server (${d})` : "Other", imap: { host: `imap.${d}`, port: 993 }, smtp: { host: `smtp.${d}`, port: 465 },
    hint: "Company mailboxes: ask your IT team for the IMAP and SMTP server names if the guesses below are wrong. Google Workspace domains use the Gmail settings." };
}
export const PRESETS = Object.values(P);
/** Allowed ports only: standard mail ports. Anything else is refused so the server cannot be pointed at arbitrary services. */
export const IMAP_PORTS = [993, 143], SMTP_PORTS = [465, 587];
