import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { measure } from "../skills/made-to-measure/scripts/checks.mjs";
import { witnessVerdict } from "../skills/made-to-measure/scripts/fit.mjs";

const root = new URL("../", import.meta.url);
const controls = JSON.parse(readFileSync(new URL("examples/controls/controls.json", root)));
const at = (file) => new URL(file, root).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const failing = (m) => m.results.filter((r) => !r.pass && !r.advisory).map((r) => r.name);

for (const c of controls.code) {
  test(`code control ${c.id} fails ${c.fails.join(", ")}`, () => {
    assert.deepEqual(failing(measure(at(c.file), c.slot, [], c.generated)), c.fails);
  });
}

for (const c of controls.witness) {
  test(`witness control ${c.id}: code passes, recorded answers fail`, () => {
    const m = measure(at(c.file), slotOf(c), []);
    assert.deepEqual(failing(m), []);
    assert.equal(witnessVerdict(c.answers).pass, false);
  });
}

// the attempt's own slot from its example's plan, so the checks run exactly as they did in the pilot
function slotOf(c) {
  const [example, slot] = c.slot.split("/");
  const plan = JSON.parse(readFileSync(new URL(`examples/${example}/after/.made-to-measure/plan.json`, root)));
  const s = plan.slots.find((p) => p.id === slot);
  return { width: s.width, height: s.height, overlay: s.overlay, max_kb: s.max_kb };
}
