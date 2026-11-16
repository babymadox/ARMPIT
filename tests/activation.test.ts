import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCode, normalizeCode, hashCode, looksLikeCode } from "../src/lib/activation.ts";

test("codes have the documented shape and use only unambiguous characters", () => {
  for (let i = 0; i < 200; i++) {
    const c = generateCode();
    assert.match(c, /^ARMPIT-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
    assert.ok(!/[01OILU]/.test(c.replace("ARMPIT", "")), `look-alike character in ${c}`);
    assert.ok(looksLikeCode(c));
  }
});
test("codes are random: no repeats across many draws and every symbol gets used", () => {
  const seen = new Set<string>(), used = new Set<string>();
  for (let i = 0; i < 5000; i++) { const c = generateCode(); assert.ok(!seen.has(c), "repeat"); seen.add(c); for (const ch of c.slice(7).replace(/-/g, "")) used.add(ch); }
  assert.equal(used.size, 30, "all 30 symbols appear, so nothing is biased out");
});
test("typing variations of one code all normalise to the same value and hash", () => {
  const c = "ARMPIT-A2B3-C4D5-E6F7-G8H9";
  const variants = [c, c.toLowerCase(), "  " + c + "  ", c.replace(/-/g, " "), c.replace(/-/g, ""), "armpit a2b3 c4d5 e6f7 g8h9", "ARMPIT–A2B3–C4D5–E6F7–G8H9"];
  for (const v of variants) { assert.equal(normalizeCode(v), "ARMPITA2B3C4D5E6F7G8H9", JSON.stringify(v)); assert.equal(hashCode(v), hashCode(c)); }
  assert.notEqual(hashCode(c), hashCode("ARMPIT-A2B3-C4D5-E6F7-G8HA"), "one different character gives a different hash");
});
test("the hash is a plain sha256 of the normalised code (the database computes the same)", () => {
  // Fixed vector. The end-to-end database test asserts Postgres produces this exact value for the same text.
  assert.equal(hashCode("ARMPIT-A2B3-C4D5-E6F7-G8H9"), "f48d71beb45ae719eb46dffbe2270986bd9cf499ea505874d90dc2df863569fd");
  assert.match(hashCode("x"), /^[0-9a-f]{64}$/);
});
test("the form rejects text that cannot be a code before it reaches the database", () => {
  assert.equal(looksLikeCode(""), false); assert.equal(looksLikeCode("hello"), false); assert.equal(looksLikeCode("ARMPIT-1234"), false); assert.equal(looksLikeCode(generateCode()), true);
});
