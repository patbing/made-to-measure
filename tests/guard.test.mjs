import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generationSize, renderHtml, safeOutput, witnessVerdict, yes } from "../skills/made-to-measure/scripts/fit.mjs";
import { createTransport, parseJson } from "../skills/made-to-measure/scripts/pollinations.mjs";

test("slot paths stay inside the project and are image files", () => {
  const root = join(tmpdir(), "proj");
  assert.equal(safeOutput(root, "public/img/hero.jpg"), join(root, "public/img/hero.jpg"));
  assert.throws(() => safeOutput(root, "../outside.jpg"), /inside the project/);
  assert.throws(() => safeOutput(root, "a/../../b.jpg"), /inside the project/);
  assert.throws(() => safeOutput(root, join(root, "abs.jpg")), /inside the project/);
  assert.throws(() => safeOutput(root, "script.js"), /\.jpg/);
});

test("generation keeps the slot's aspect within model limits", () => {
  assert.deepEqual(generationSize(1200, 630), { width: 1200, height: 624 });
  assert.deepEqual(generationSize(400, 300), { width: 768, height: 576 });
  assert.deepEqual(generationSize(3000, 1000), { width: 1536, height: 512 });
});

test("the ledger refuses a call that could pass the budget, and counts failed calls at worst case", async () => {
  process.env.POLLINATIONS_API_KEY = "sk_test_not_real";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream down", { status: 500 });
  try {
    const t = createTransport({ budget: 0.003 });
    const out = join(mkdtempSync(join(tmpdir(), "mtm-")), "x.jpg");
    await assert.rejects(t.image({ model: "m", prompt: "p", width: 64, height: 64, seed: 1, out, price: 0.002 }), /HTTP 500/);
    assert.equal(t.spent(), 0.002);
    await assert.rejects(t.image({ model: "m", prompt: "p", width: 64, height: 64, seed: 2, out, price: 0.002 }), /budget/);
    assert.equal(t.ledger.length, 1);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.POLLINATIONS_API_KEY;
  }
});

test("parseJson takes the object out of a chatty reply", () => {
  assert.deepEqual(parseJson('Sure!\n{"prompt": "a loaf"}\nDone.'), { prompt: "a loaf" });
  assert.throws(() => parseJson("no json"), /no JSON/);
});

test("the HTML report escapes model and repository text", () => {
  const html = renderHtml({ project: "<script>x</script>", direction: "a & b", cost: { pollen: 0, calls: 0 },
    slots: [{ id: "s", width: 1, height: 1, status: "PASS", file: "f", line: 1, subject: "<img onerror=1>",
      attempts: [{ n: 1, model: "m", seed: 1, prompt: "\"><script>", checks: [] }] }] });
  assert.ok(!html.includes("<script>x"));
  assert.ok(!html.includes("<img onerror"));
  assert.ok(html.includes("&#60;script&#62;x"));
});

test("witness answers: words and JSON booleans read the same way", () => {
  for (const v of ["yes", "Yes.", " y", true, "true"]) assert.equal(yes(v), true, String(v));
  for (const v of ["no", "No.", false, "false", undefined, ""]) assert.equal(yes(v), false, String(v));
  assert.equal(witnessVerdict({ subject: yes(true), decoy: yes(false), text: yes(true) }).pass, false);
});

test("a signed-out polli CLI is not taken as signed in", () => {
  const dir = mkdtempSync(join(tmpdir(), "mtm-polli-"));
  const saved = { key: process.env.POLLINATIONS_API_KEY, bin: process.env.POLLI_BIN };
  delete process.env.POLLINATIONS_API_KEY;
  try {
    for (const [status, want] of [[{ authenticated: false }, null], [{ authenticated: true }, "polli"]]) {
      const bin = join(dir, `polli-${want}.mjs`);
      writeFileSync(bin, `console.log(${JSON.stringify(JSON.stringify(status))});`);
      process.env.POLLI_BIN = bin;
      assert.equal(createTransport().mode(), want);
    }
  } finally {
    if (saved.key !== undefined) process.env.POLLINATIONS_API_KEY = saved.key;
    if (saved.bin === undefined) delete process.env.POLLI_BIN; else process.env.POLLI_BIN = saved.bin;
  }
});
