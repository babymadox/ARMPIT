import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogFor, formatValue, parseSelection, valueOf } from "../src/lib/columns.ts";

const cat = catalogFor("singular");
const col = (k: string) => cat.cols.find((c) => c.key === k)!;

test("derived columns are ratios of totals, not sums of row ratios", () => {
  const a = { custom_installs: 10, custom_clicks: 100 }, b = { custom_installs: 30, custom_clicks: 100 };
  const total = { custom_installs: 40, custom_clicks: 200 };
  assert.equal(valueOf(col("d_install_rate"), a), 10);
  assert.equal(valueOf(col("d_install_rate"), total), 20, "40/200, not 10%+30%");
  assert.equal(valueOf(col("d_install_rate"), { custom_installs: 5 }), null, "no clicks -> no rate");
  assert.equal(valueOf(col("custom_installs"), b), 30);
});
test("missing data renders as a dash, formats follow the metric kind", () => {
  assert.equal(formatValue(col("adn_cost"), null), "—");
  assert.equal(formatValue(col("adn_cost"), 1164.6), "$1,164.60");
  assert.equal(formatValue(col("custom_installs"), 45849), "45,849");
  assert.equal(formatValue(col("d_install_rate"), 12.3456), "12.35%");
});
test("selection keeps valid keys in catalogue order and falls back to defaults", () => {
  assert.deepEqual(parseSelection("custom_clicks,custom_installs,bogus", cat), ["custom_installs", "custom_clicks"]);
  assert.deepEqual(parseSelection("bogus", cat), cat.defaults);
  assert.deepEqual(parseSelection(undefined, cat), cat.defaults);
});
test("trackers without a catalogue fall back to the metrics seen in their data", () => {
  const c = catalogFor("cellxpert", ["qftd", "commission"]);
  assert.deepEqual(c.cols.map((x) => x.key), ["qftd", "commission"]);
  assert.equal(c.cols[1].fmt, "money");
});
