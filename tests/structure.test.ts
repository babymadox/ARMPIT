import { test } from "node:test";
import assert from "node:assert/strict";
import { planImport } from "../src/lib/structure.ts";

// Mirrors the real shape: a source can work with several agencies, an agency with several sources.
const pairs = [
  { source: "AdWords", agency: "Viking Media" }, { source: "AdWords", agency: "Velocity Ads" },
  { source: "Unity", agency: "Viking Media" }, { source: "Unity", agency: "viking media" },
  { source: "TikTok", agency: "" }, { source: "", agency: "Ghost" },
];

test("many-to-many: both pairs of a shared source are kept, agencies are created once", () => {
  const plan = planImport(pairs, [], []);
  assert.deepEqual(plan.toCreate.sort(), ["Velocity Ads", "Viking Media"]);
  assert.equal(plan.newPairs.length, 4, "AdWords×2 and Unity×2 (the case-variant agency is a separate Singular pair)");
  assert.ok(plan.newPairs.some((p) => p.source === "AdWords" && p.agency === "Velocity Ads"));
  assert.ok(plan.newPairs.some((p) => p.source === "AdWords" && p.agency === "Viking Media"));
});
test("pairs without an agency or source are skipped", () => {
  const plan = planImport(pairs, [], []);
  assert.equal(plan.newPairs.some((p) => p.source === "TikTok" || p.agency === "Ghost"), false);
});
test("existing partners are matched by exact name, not fuzzily", () => {
  const plan = planImport(pairs, [{ id: "p1", name: "VIKING MEDIA" }, { id: "p2", name: "Velocity" }], []);
  assert.equal(plan.partnerIdFor("Viking Media"), "p1");
  assert.equal(plan.partnerIdFor("Velocity Ads"), null, "'Velocity' is not 'Velocity Ads'");
  assert.deepEqual(plan.toCreate, ["Velocity Ads"]);
});
test("re-running the import creates nothing new", () => {
  const links = pairs.filter((p) => p.agency && p.source).map((p) => ({ external_id: p.source, external_group: p.agency }));
  const plan = planImport(pairs, [{ id: "1", name: "Viking Media" }, { id: "2", name: "Velocity Ads" }], links);
  assert.equal(plan.newPairs.length, 0); assert.equal(plan.toCreate.length, 0);
});
