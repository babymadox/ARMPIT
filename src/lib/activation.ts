import { createHash, randomInt } from "node:crypto";

/**
 * Activation codes. 16 characters from a 32-symbol alphabet with no look-alikes (no 0/O, 1/I/L, U) is 80 bits of
 * randomness: not guessable. Only the SHA-256 of a code is ever stored, and only the operator can create one
 * (the admin endpoint needs CRON_SECRET, which is never committed), so copying the source code does not let anyone mint
 * a code that the database will accept.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";   // 30 symbols; look-alikes removed (0 O 1 I L U)
const GROUPS = 4, GROUP_LEN = 4;

/** "ARMPIT-XXXX-XXXX-XXXX-XXXX" using the cryptographic RNG (never Math.random). */
export function generateCode(): string {
  const groups = Array.from({ length: GROUPS }, () => Array.from({ length: GROUP_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""));
  return `ARMPIT-${groups.join("-")}`;
}

/** Must stay identical to the SQL in redeem_activation_code(): keep letters and digits only, then upper-case. */
export const normalizeCode = (raw: string) => raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
/** sha256 as hex: the same value the database computes with encode(digest(..., 'sha256'), 'hex'). */
export const hashCode = (raw: string) => createHash("sha256").update(normalizeCode(raw)).digest("hex");

/** True when the text could be a code (right length once cleaned). Used only to give a friendlier form error. */
export const looksLikeCode = (raw: string) => normalizeCode(raw).length === "ARMPIT".length + GROUPS * GROUP_LEN;
