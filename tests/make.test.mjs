import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cmdCheck, cmdMake, cmdPlan } from "../skills/made-to-measure/scripts/fit.mjs";
import { scan } from "../skills/made-to-measure/scripts/scan.mjs";

let hasFfmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }

/** A JPEG made by ffmpeg: dark left side for text, a lit object on the right. */
function picture(dir, name, light) {
  const out = join(dir, name);
  const bg = light ? "0xe8e0d0" : "0x2a1d14";
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${bg}:s=768x432`, "-vf",
    "drawbox=x=480:y=120:w=200:h=200:color=0xb45309:t=fill,noise=alls=20:allf=t", "-frames:v", "1", out]);
  return readFileSync(out);
}

test("plan → make → check on the fixture site, with Pollinations replaced by canned replies", { skip: !hasFfmpeg && "ffmpeg not on PATH" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "mtm-site-"));
  cpSync(join(import.meta.dirname, "fixtures", "site"), root, { recursive: true });
  const plan = scan(root);
  plan.slots = plan.slots.filter((s) => s.id === "bakers-at-dawn" || s.id === "dark-rye-loaf");
  plan.slots[0].overlay = { x: 0, y: 0, w: 0.45, h: 1, color: "#ffffff", large: true };
  mkdirSync(join(root, ".made-to-measure"), { recursive: true });
  writeFileSync(join(root, ".made-to-measure", "plan.json"), JSON.stringify(plan));

  const art = mkdtempSync(join(tmpdir(), "mtm-art-"));
  const dark = picture(art, "dark.jpg", false);
  const light = picture(art, "light.jpg", true);
  const calls = [];
  let heroImages = 0;
  const realFetch = globalThis.fetch;
  process.env.POLLINATIONS_API_KEY = "sk_test_not_real";
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/v1/models/")) {
      const id = decodeURIComponent(u.split("/v1/models/")[1]);
      const image = /flux|z-image/.test(id);
      return Response.json({ id, paid_only: false, pricing: image ? { completionImageTokens: "0.002" }
        : { promptTextTokens: "0.0000002", promptImageTokens: "0.0000002", completionTextTokens: "0.000001" } });
    }
    if (u.includes("/image/")) {
      const hero = decodeURIComponent(u).includes("bakers");
      calls.push(hero ? "image:hero" : "image:rye");
      // the hero's first picture is light behind white text, so contrast fails and gets repaired
      const bytes = hero && heroImages++ === 0 ? light : dark;
      return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
    }
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    let reply;
    if (system.startsWith("You are the art director")) {
      calls.push("plan");
      reply = { direction: "Warm low light, film grain.", slots: [
        { id: "bakers-at-dawn", subject: "bakers at dawn", prompt: "bakers at dawn shaping loaves, dark empty left third" },
        { id: "dark-rye-loaf", subject: "a dark rye loaf", prompt: "a dark rye loaf on a board" }] };
    } else if (system.startsWith("You fix")) {
      calls.push("repair");
      reply = { prompt: "bakers at dawn, the left 45% in deep shadow" };
    } else {
      calls.push("witness");
      reply = { answers: { subject: "yes", decoy: "no", text: "no" } };
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }],
      usage: { prompt_tokens: 500, completion_tokens: 100 } });
  };
  try {
    await cmdPlan(root, {});
    const code = await cmdMake(root, { budget: "0.05" });
    const report = JSON.parse(readFileSync(join(root, ".made-to-measure", "report.json"), "utf8"));
    const hero = report.slots.find((s) => s.id === "bakers-at-dawn");
    const rye = report.slots.find((s) => s.id === "dark-rye-loaf");
    assert.equal(hero.attempts.length, 2);
    assert.ok(hero.attempts[0].problems.some((p) => p.startsWith("contrast")));
    assert.equal(hero.status, "PASS");
    assert.equal(rye.status, "PASS");
    assert.equal(code, 0);
    assert.ok(existsSync(join(root, "assets", "bakers-at-dawn.jpg")));
    assert.ok(existsSync(join(root, "img", "rye.jpg")));
    // attempt 1 fails only on contrast, so the witness checks it too in case the scrim is needed
    assert.deepEqual(calls, ["plan", "image:hero", "witness", "repair", "image:hero", "witness", "image:rye", "witness"]);
    assert.ok(report.cost.pollen > 0.006 && report.cost.pollen < 0.01);
    assert.equal(cmdCheck(root), 0);
    // a second run never overwrites the pictures it placed
    const again = await cmdMake(root, {});
    assert.equal(again, 2);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.POLLINATIONS_API_KEY;
  }
});
