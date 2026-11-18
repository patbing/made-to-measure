import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { brandColors, scan, sizeFromUrl } from "../skills/made-to-measure/scripts/scan.mjs";

test("sizeFromUrl reads the common placeholder shapes", () => {
  assert.deepEqual(sizeFromUrl("https://placehold.co/1344x768"), { width: 1344, height: 768 });
  assert.deepEqual(sizeFromUrl("https://picsum.photos/600/400"), { width: 600, height: 400 });
  assert.deepEqual(sizeFromUrl("https://via.placeholder.com/300"), { width: 300, height: 300 });
});

test("brandColors reads CSS custom properties", () => {
  assert.deepEqual(brandColors([":root{--a:#B45309;--b: #fff}"]), ["#b45309", "#fff"]);
});

test("scan finds placeholders, missing files and the missing og:image, not existing images", () => {
  const plan = scan(join(import.meta.dirname, "fixtures", "site"));
  const by = Object.fromEntries(plan.slots.map((s) => [s.ref ?? s.kind, s]));
  assert.equal(plan.slots.length, 5);
  assert.deepEqual(plan.brand.colors, ["#b45309", "#1c1917", "#fef3c7"]);

  const hero = by["https://placehold.co/1344x768"];
  assert.equal(hero.kind, "placeholder");
  assert.equal(hero.alt, "Bakers at dawn");
  assert.equal(`${hero.width}x${hero.height}`, "1344x768");
  assert.equal(hero.context, "Sourdough, baked at four");
  assert.equal(hero.file, "index.html");
  assert.equal(hero.line, 5);

  const rye = by["img/rye.jpg"];
  assert.equal(rye.kind, "missing");
  assert.equal(rye.path, "img/rye.jpg");
  assert.equal(`${rye.width}x${rye.height}`, "800x600");

  assert.equal(by["https://picsum.photos/600/400"].width, 600);
  assert.equal(by["docs/banner.png"].file, "README.md");
  assert.equal(by["docs/banner.png"].context, "Banner");
  assert.equal(by.og.path, "og.jpg");
  assert.equal(by.og.context, "Crumb &amp; Co.");
  assert.equal(new Set(plan.slots.map((s) => s.id)).size, 5);
  assert.ok(!plan.slots.some((s) => s.ref === "img/logo.png"));
});
