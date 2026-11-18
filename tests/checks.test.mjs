import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as C from "../skills/made-to-measure/scripts/checks.mjs";

const dir = mkdtempSync(join(tmpdir(), "mtm-"));
let hasFfmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }
const ff = { skip: !hasFfmpeg && "ffmpeg not on PATH" };

/** Draw a test picture with ffmpeg's lavfi sources. */
function draw(name, source, size = "320x180") {
  const out = join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `${source}${source.includes("=") ? ":" : "="}s=${size}`,
    "-frames:v", "1", out]);
  return out;
}

test("WCAG contrast: black on white is 21, same colour is 1", () => {
  assert.equal(Math.round(C.contrastRatio([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(C.contrastRatio([90, 90, 90], [90, 90, 90]), 1);
  assert.equal(Math.round(C.contrastRatio([119, 119, 119], [255, 255, 255]) * 100) / 100, 4.48);
});

test("Lab: pure red has hue near 40 degrees and high chroma", () => {
  const [L, a, b] = C.toLab([255, 0, 0]);
  assert.ok(Math.abs(L - 53.2) < 0.5);
  assert.ok(Math.hypot(a, b) > 100);
});

test("hamming counts differing bits", () => {
  assert.equal(C.hamming("ff00", "0f00"), 4);
});

test("a flat picture has no detail; a test pattern does", ff, () => {
  const flat = draw("flat.png", "color=c=0x777777");
  const busy = draw("busy.png", "testsrc2");
  assert.ok(C.detail(C.pixels(flat, 64, 64)) < 1);
  assert.ok(C.detail(C.pixels(busy, 64, 64)) > C.THRESHOLDS.minDetail);
});

test("contrast zone: white text passes on a dark left half, fails on the light right", ff, () => {
  // left half near black, right half near white
  const out = join(dir, "split.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    "color=c=0x101010:s=320x180", "-vf", "drawbox=x=160:y=0:w=160:h=180:color=0xf0f0f0:t=fill",
    "-frames:v", "1", out]);
  const left = C.pixels(out, 48, 48, { x: 0, y: 0, w: 0.45, h: 1 });
  const right = C.pixels(out, 48, 48, { x: 0.55, y: 0, w: 0.45, h: 1 });
  assert.ok(C.zoneContrast(left, "#ffffff") > 15);
  assert.ok(C.zoneContrast(right, "#ffffff") < 1.2);
  const scrim = C.minimumScrim(right, "#ffffff", 4.5);
  assert.deepEqual(scrim.rgb, [0, 0, 0]);
  assert.ok(scrim.alpha > 0.4 && scrim.alpha < 0.8, `alpha ${scrim.alpha}`);
  assert.ok(C.zoneContrast(right, "#ffffff", scrim.alpha, scrim.rgb) >= 4.5);
});

test("palette: a blue picture is on a blue brand and off a red one", ff, () => {
  const blue = draw("blue.png", "color=c=0x2050c0");
  const px = C.pixels(blue, 16, 16);
  assert.equal(C.offPalette(px, ["#1d4ed8"]), 0);
  assert.equal(C.offPalette(px, ["#dc2626"]), 1);
  // neutral pixels never count against the palette
  assert.equal(C.offPalette(C.pixels(draw("grey.png", "color=c=0x808080"), 16, 16), ["#dc2626"]), 0);
});

test("fitTo crops to the exact slot and stays under the weight limit", ff, () => {
  const src = draw("src.png", "testsrc2", "1024x576");
  const out = join(dir, "card.jpg");
  const p = C.fitTo(src, out, 800, 600, 120);
  assert.equal(`${p.width}x${p.height}`, "800x600");
  assert.ok(p.bytes <= 120 * 1024);
});

test("measure: reports every rule with its value and a scrim when only contrast fails", ff, () => {
  const src = draw("light.png", "testsrc2", "1200x630");
  const out = join(dir, "og.jpg");
  C.fitTo(src, out, 1200, 630);
  const m = C.measure(out, { width: 1200, height: 630,
    overlay: { x: 0, y: 0, w: 0.5, h: 1, color: "#ffffff", large: false } },
  [], { width: 1200, height: 630 });
  const by = Object.fromEntries(m.results.map((r) => [r.name, r]));
  assert.equal(by.size.pass, true);
  assert.equal(by.weight.pass, true);
  assert.equal(by.detail.pass, true);
  assert.equal(by.contrast.pass, false);
  assert.ok(m.scrim && m.scrim.alpha > 0);
  assert.match(m.hash, /^[0-9a-f]{16}$/);
});
