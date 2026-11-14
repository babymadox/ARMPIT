import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestPartner } from "../src/lib/suggest.ts";

const partners = [{ id: "1", name: "Lucky Partners" }, { id: "2", name: "Viking Media Ltd" }, { id: "3", name: "Velocity Ads" }, { id: "4", name: "Velocity Labs" }];

test("exact match ignores case, punctuation and company suffixes", () => {
  assert.equal(suggestPartner("vikingmedia", partners)?.id, "2");
  assert.equal(suggestPartner("VIKING MEDIA LIMITED", partners)?.id, "2");
  assert.equal(suggestPartner("Lucky", partners)?.id, "1", "a noise word like 'Partners' does not block a match");
});
test("ambiguous or too-short names are not suggested", () => {
  assert.equal(suggestPartner("Velocity", partners), null, "contained in two partner names");
  assert.equal(suggestPartner("AdWords", partners), null);
  assert.equal(suggestPartner("ab", partners), null);
});
