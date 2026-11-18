#!/usr/bin/env node
// made-to-measure: find empty image slots, have Pollinations models draw them,
// measure every picture with code, repair what fails, report with receipts.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { dhash, measure, fitTo, hamming, THRESHOLDS } from "./checks.mjs";
import { createTransport, DEFAULT_MODELS, modelInfo } from "./pollinations.mjs";
import { scan } from "./scan.mjs";

const ZONES = {
  left: { x: 0, y: 0, w: 0.45, h: 1 }, right: { x: 0.55, y: 0, w: 0.45, h: 1 },
  top: { x: 0, y: 0, w: 1, h: 0.4 }, bottom: { x: 0, y: 0.6, w: 1, h: 0.4 },
  center: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 },
};
const MAX_ATTEMPTS = 3;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) { opts._.push(a); continue; }
    const name = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) opts[name] = true;
    else { opts[name] = next; i++; }
  }
  return { cmd, opts };
}

const workDir = (root) => join(root, ".made-to-measure");
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
const seed = () => Math.floor(Math.random() * 2 ** 31);

/** Output paths come from plan.json; keep them inside the project and image-typed. */
export function safeOutput(root, path) {
  if (!path || isAbsolute(path) || normalize(path).split(/[\\/]/).includes("..")) {
    throw new Error(`slot path must be relative and inside the project: ${path}`);
  }
  if (!/\.(jpe?g|png|webp)$/i.test(path)) throw new Error(`slot path must end in .jpg, .png or .webp: ${path}`);
  return join(root, path);
}

/** Generation size: the slot's aspect, long side 768-1536, multiples of 16. */
export function generationSize(w, h) {
  const scale = Math.min(1536 / Math.max(w, h), Math.max(1, 768 / Math.max(w, h)));
  const r16 = (x) => Math.max(256, Math.round((x * scale) / 16) * 16);
  return { width: r16(w), height: r16(h) };
}

async function prices(models, allowPaid) {
  const out = {};
  for (const [role, id] of Object.entries(models)) {
    const info = await modelInfo(id);
    if (!info) throw new Error(`model ${id} (${role}) is not in the Pollinations catalog`);
    if (info.paid_only && !allowPaid) {
      throw new Error(`model ${id} (${role}) is paid-only; pass --allow-paid to use it`);
    }
    out[role] = { id, paid_only: info.paid_only, pricing: info.pricing };
  }
  return out;
}

const imagePrice = (p) => Number(p.pricing.completionImageTokens ?? 0.01);

function modelsFrom(opts) {
  return {
    text: opts["text-model"] ?? DEFAULT_MODELS.text,
    image: opts["image-model"] ?? DEFAULT_MODELS.image,
    image2: opts["image-model-2"] ?? DEFAULT_MODELS.image2,
    witness: opts["witness-model"] ?? DEFAULT_MODELS.witness,
  };
}

const RULES = `Rules the code will measure on every picture:
- It is cropped to the slot's exact size; plan the composition for that aspect ratio.
- No words, letters, numbers, logos or watermarks anywhere in the picture.
- Where a slot has a text zone, page text in the given colour sits there: that area must be calm, low-detail and ${"dark or light enough"} for a ${THRESHOLDS.minContrast}:1 contrast with that colour (${THRESHOLDS.minContrastLarge}:1 for large text). Say in the prompt where the empty area is and how dark or light it is.
- Colourful areas should stay within the brand hues given (within ${THRESHOLDS.hueTolerance} degrees); neutrals are always fine.
- Each slot shows its own subject, clearly enough that someone who never saw the prompt can name it.
- No two slots share a main subject: a viewer is also asked whether the picture shows another slot's subject, and a yes fails it.`;

export async function cmdPlan(root, opts) {
  const plan = readJson(join(workDir(root), "plan.json"));
  const models = modelsFrom(opts);
  const priced = await prices(models, opts["allow-paid"]);
  const t = createTransport({ budget: Number(opts.budget ?? 0.1) });
  if (!t.mode()) throw new Error("not signed in: run `polli auth login` or set POLLINATIONS_API_KEY. Nothing was charged.");
  const readme = ["README.md", "readme.md", "index.html"].map((f) => join(root, f)).find(existsSync);
  const about = plan.about ?? (readme ? readFileSync(readme, "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500) : "");
  const slots = plan.slots.map(({ id, width, height, alt, context, overlay, subject }) =>
    ({ id, width, height, alt, context, text_zone: overlay ?? null, subject: subject ?? null }));
  const system = `You are the art director for one project. Choose ONE art direction for all of its pictures (medium, light, palette use, mood) from the project's own words and colours, then write one image prompt per slot for a fast text-to-image model.
${RULES}
Return JSON: {"direction": "<one paragraph>", "slots": [{"id": "<slot id>", "subject": "<the thing a viewer should recognise, 2-6 words>", "prompt": "<under 90 words, starts with the subject, states the empty text area if any>"}]}`;
  const user = JSON.stringify({ project: plan.project, about, brand_colors: plan.brand?.colors ?? [], slots });
  const reply = await t.json({ step: "plan", model: priced.text.id, system, user, seed: seed(), pricing: priced.text.pricing });
  const byId = new Map((reply.slots ?? []).map((s) => [s.id, s]));
  plan.direction = reply.direction ?? plan.direction;
  for (const slot of plan.slots) {
    const r = byId.get(slot.id);
    if (!r?.prompt) throw new Error(`the model left slot ${slot.id} without a prompt`);
    slot.subject = slot.subject ?? r.subject;
    slot.prompt = r.prompt;
  }
  writeJson(join(workDir(root), "plan.json"), plan);
  const n = plan.slots.length;
  const first = n * (imagePrice(priced.image) + 0.0003);
  const worst = n * (2 * imagePrice(priced.image) + imagePrice(priced.image2) + 3 * 0.0003 + 2 * 0.003);
  writeJson(join(workDir(root), "plan-receipt.json"), t.ledger);
  console.log(`direction: ${plan.direction}\n${n} slots. Estimated cost: about ${first.toFixed(3)} Pollen if every picture passes first time, at most ${worst.toFixed(3)} with every repair. Plan call: ${t.spent().toFixed(4)}.`);
}

function failures(m) {
  return m.results.filter((r) => !r.pass && !r.advisory).map((r) => `${r.name}: measured ${r.value}, needs ${r.rule}`);
}

export async function witness(t, priced, file, subject, decoy) {
  const qs = [
    ["subject", `Is the main subject of this picture: ${subject}?`],
    ...(decoy ? [["decoy", `Is the main subject of this picture: ${decoy}?`]] : []),
    ["text", "Does the picture contain readable words, letters, numbers, a logo or a watermark?"],
  ].sort(() => Math.random() - 0.5);
  const system = "You see one picture and nothing else. Answer each question with yes or no from what is visible. Return JSON: {\"answers\": {\"<key>\": \"yes\"|\"no\"}}";
  const user = qs.map(([k, q]) => `${k}: ${q}`).join("\n");
  const reply = await t.json({ step: "witness", model: priced.witness.id, system, user, seed: seed(),
    imageFile: file, pricing: priced.witness.pricing, maxTokens: 800 });
  const a = Object.fromEntries(Object.entries(reply.answers ?? {}).map(([k, v]) => [k, String(v).toLowerCase().startsWith("y")]));
  return { answers: a, ...witnessVerdict(a) };
}

/** A viewer must see the subject, no text, and not mistake it for another slot. */
export function witnessVerdict(a) {
  return { trusted: a.decoy !== true && a.subject !== undefined, pass: a.subject === true && a.text === false && a.decoy !== true };
}

async function repairPrompt(t, priced, slot, prompt, problems) {
  const system = `You fix one image prompt that failed measurement. Keep the subject and the art direction. ${RULES}\nReturn JSON: {"prompt": "<under 90 words>"}`;
  const user = JSON.stringify({ slot: { id: slot.id, width: slot.width, height: slot.height, text_zone: slot.overlay ?? null },
    previous_prompt: prompt, measured_failures: problems });
  const reply = await t.json({ step: "repair", model: priced.text.id, system, user, seed: seed(), pricing: priced.text.pricing });
  return reply.prompt || prompt;
}

export async function cmdMake(root, opts) {
  const dir = workDir(root);
  const plan = readJson(join(dir, "plan.json"));
  const models = modelsFrom(opts);
  const priced = await prices(models, opts["allow-paid"]);
  const t = createTransport({ budget: Number(opts.budget ?? 0.1) });
  if (!t.mode()) throw new Error("not signed in: run `polli auth login` or set POLLINATIONS_API_KEY. Nothing was charged.");
  const useWitness = !opts["no-witness"];
  const report = { project: plan.project, direction: plan.direction, models, thresholds: THRESHOLDS,
    started: new Date().toISOString(), slots: [] };
  const passedHashes = [];
  mkdirSync(join(dir, "attempts"), { recursive: true });
  // --only a,b: rerun those slots, keep every other slot and all earlier attempts and receipts.
  const only = opts.only ? String(opts.only).split(",") : null;
  const prev = only ? readJson(join(dir, "report.json")) : null;
  const prevLedger = only ? readJson(join(dir, "receipt.json")) : [];
  const prevEntry = (id) => prev?.slots.find((e) => e.id === id);
  if (prev) {
    report.started = prev.started;
    report.reruns = [...(prev.reruns ?? []), { at: new Date().toISOString(), slots: only }];
    for (const e of prev.slots) if (e.final && !only.includes(e.id)) passedHashes.push(dhash(join(root, e.final)));
  }

  for (const slot of plan.slots) {
    if (only && !only.includes(slot.id)) {
      report.slots.push(prevEntry(slot.id));
      continue;
    }
    const target = safeOutput(root, slot.path);
    const earlier = prevEntry(slot.id)?.attempts ?? [];
    const entry = { id: slot.id, path: slot.path, file: slot.file, line: slot.line, ref: slot.ref,
      width: slot.width, height: slot.height, subject: slot.subject, status: "FAILED", attempts: [...earlier] };
    report.slots.push(entry);
    if (!slot.width || !slot.height || !slot.prompt) {
      entry.status = "NOT ATTEMPTED (plan incomplete)";
      continue;
    }
    if (existsSync(target) && !opts.overwrite) {
      entry.status = "NOT ATTEMPTED (file exists; pass --overwrite)";
      continue;
    }
    const others = plan.slots.filter((s) => s.id !== slot.id && s.subject);
    const decoy = others.length ? others[Math.floor(Math.random() * others.length)].subject : null;
    let prompt = slot.prompt;
    let best = null;
    for (let k = 1; k <= MAX_ATTEMPTS; k++) {
      const n = earlier.length + k;
      const model = k < MAX_ATTEMPTS ? priced.image : priced.image2;
      const gen = generationSize(slot.width, slot.height);
      const s = seed();
      const raw = join(dir, "attempts", `${slot.id}-${n}.raw`);
      const fitted = join(dir, "attempts", `${slot.id}-${n}${/\.png$/i.test(slot.path) ? ".png" : ".jpg"}`);
      const attempt = { n, model: model.id, seed: s, prompt, generated: gen };
      entry.attempts.push(attempt);
      try {
        await t.image({ model: model.id, prompt, ...gen, seed: s, out: raw, price: imagePrice(model) });
      } catch (err) {
        attempt.error = err.message;
        if (err.code === "BUDGET") { entry.status = "NOT ATTEMPTED (budget)"; break; }
        continue;
      }
      fitTo(raw, fitted, slot.width, slot.height, slot.max_kb ?? THRESHOLDS.maxKb);
      const m = measure(fitted, slot, plan.brand?.colors ?? [], gen);
      const near = passedHashes.find((h) => hamming(h, m.hash) < THRESHOLDS.minDistinct);
      m.results.push({ name: "distinct", value: near ? "same as another slot" : "ok", pass: !near,
        rule: `differs from every other slot by at least ${THRESHOLDS.minDistinct} hash bits` });
      attempt.checks = m.results;
      attempt.file = fitted.slice(root.length + 1).split("\\").join("/");
      let problems = failures({ results: m.results });
      const onlyContrast = problems.length === 1 && problems[0].startsWith("contrast") && m.scrim;
      if ((problems.length === 0 || onlyContrast) && useWitness) {
        try {
          attempt.witness = await witness(t, priced, fitted, slot.subject, decoy);
          if (!attempt.witness.pass) {
            problems.push(attempt.witness.answers.text ? "witness: a viewer sees readable text, a logo or a watermark"
              : attempt.witness.answers.decoy ? "witness: a viewer mistakes it for another slot's subject"
              : `witness: a viewer who never saw the prompt does not see "${slot.subject}"`);
          }
        } catch (err) {
          attempt.witness = { error: err.message };
        }
      }
      attempt.problems = problems;
      const witnessOk = !useWitness || attempt.witness?.pass === true;
      const witnessUnknown = useWitness && (attempt.witness?.error || attempt.witness?.trusted === false);
      if (problems.length === 0 && witnessOk) { entry.status = "PASS"; best = { fitted, m }; break; }
      if (onlyContrast && problems.length === 1 && witnessOk) best = { fitted, m, scrim: m.scrim };
      if (witnessUnknown && problems.length === 0) { entry.status = "UNVERIFIED"; best = null; break; }
      if (k < MAX_ATTEMPTS) {
        try { prompt = await repairPrompt(t, priced, slot, prompt, problems); }
        catch (err) { attempt.repair_error = err.message; if (err.code === "BUDGET") break; }
      }
    }
    if (entry.status !== "PASS" && best?.scrim) {
      entry.status = "PASS WITH SCRIM";
      const [r, g, b] = best.scrim.rgb;
      entry.scrim = { ...best.scrim, zone: slot.overlay,
        css: `background: linear-gradient(rgba(${r},${g},${b},${best.scrim.alpha}), rgba(${r},${g},${b},${best.scrim.alpha})) on the text zone` };
    }
    if (entry.status.startsWith("PASS") && best) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(best.fitted, target);
      entry.final = best.fitted.slice(root.length + 1).split("\\").join("/");
      passedHashes.push(best.m.hash);
    }
  }
  report.finished = new Date().toISOString();
  const ledger = [...prevLedger, ...t.ledger];
  report.cost = { pollen: Number(ledger.reduce((a, e) => a + e.cost, 0).toFixed(4)), calls: ledger.length,
    note: "Actual cost where the API reported usage, otherwise the call's worst case. Failed calls count." };
  writeJson(join(dir, "report.json"), report);
  writeJson(join(dir, "receipt.json"), ledger);
  writeFileSync(join(dir, "report.html"), renderHtml(report));
  const counts = report.slots.reduce((c, s) => ({ ...c, [s.status]: (c[s.status] ?? 0) + 1 }), {});
  console.log(`${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}. ${report.cost.calls} calls, ${report.cost.pollen} Pollen. Report: .made-to-measure/report.html`);
  return report.slots.every((s) => s.status.startsWith("PASS")) ? 0 : 2;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderHtml(report) {
  const rows = report.slots.map((s) => `<section><h2>${esc(s.id)} <small>${esc(s.width)}×${esc(s.height)} · ${esc(s.status)}</small></h2>
<p>${esc(s.file)}:${esc(s.line)} · subject: ${esc(s.subject)}${s.scrim ? ` · scrim ${esc(s.scrim.alpha)}` : ""}</p>
<div class="row">${s.attempts.map((a) => `<figure>${a.file ? `<img src="../${esc(a.file)}" alt="attempt ${a.n}">` : ""}
<figcaption>Attempt ${a.n} · ${esc(a.model)} · seed ${esc(a.seed)}<br>${(a.checks ?? []).map((c) => `<span class="${c.pass ? "ok" : c.advisory ? "note" : "bad"}">${esc(c.name)} ${esc(c.value)}</span>`).join(" ")}
${a.witness?.answers ? `<br>witness: ${esc(JSON.stringify(a.witness.answers))}` : ""}${a.error ? `<br>error: ${esc(a.error)}` : ""}
<details><summary>prompt</summary>${esc(a.prompt)}</details></figcaption></figure>`).join("")}</div></section>`).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>made-to-measure report</title>
<style>body{font:14px/1.4 system-ui;margin:2rem;max-width:1200px}.row{display:flex;gap:1rem;flex-wrap:wrap}figure{margin:0;max-width:360px}img{max-width:360px;display:block}.ok{color:#15803d}.bad{color:#b91c1c;font-weight:600}.note{color:#a16207}</style>
<h1>${esc(report.project)}</h1><p>${esc(report.direction)}</p><p>${esc(report.cost?.pollen)} Pollen in ${esc(report.cost?.calls)} calls</p>${rows}`;
}

export function cmdCheck(root, update = false) {
  const report = readJson(join(workDir(root), "report.json"));
  const plan = readJson(join(workDir(root), "plan.json"));
  let mismatches = 0;
  let flipped = 0;
  for (const s of report.slots) {
    const slot = plan.slots.find((p) => p.id === s.id);
    for (const a of s.attempts) {
      if (!a.file || !a.checks) continue;
      const m = measure(join(root, a.file), slot, plan.brand?.colors ?? [], a.generated);
      for (const r of m.results) {
        const saved = a.checks.find((c) => c.name === r.name);
        if (saved && (saved.pass !== r.pass || saved.advisory !== r.advisory || String(saved.value) !== String(r.value))) {
          mismatches++;
          console.log(`${s.id} attempt ${a.n} ${r.name}: report says ${saved.value}, measured ${r.value}`);
          if (saved.pass !== r.pass) flipped++;
          if (update) Object.assign(saved, r);
        }
      }
    }
  }
  if (update && mismatches) {
    // Re-measuring after a rule change: values update in place; a pass/fail change needs a new `make`.
    report.thresholds = THRESHOLDS;
    report.remeasured = new Date().toISOString();
    writeJson(join(workDir(root), "report.json"), report);
    writeFileSync(join(workDir(root), "report.html"), renderHtml(report));
    console.log(`Updated ${mismatches} measurements in the report.${flipped ? ` ${flipped} changed pass/fail: run make again for those slots.` : ""}`);
    return flipped ? 2 : 0;
  }
  console.log(mismatches ? `${mismatches} measurements differ from the report` : "Every measurement in the report reproduces.");
  return mismatches ? 2 : 0;
}

export function cmdVerify(root) {
  const report = readJson(join(workDir(root), "report.json"));
  // file + ref + alt: several slots can share one placeholder URL, and only the failed ones should still use it
  const planned = new Map(readJson(join(workDir(root), "plan.json")).slots.map((s) => [s.id, s]));
  const key = (s) => `${s.file}|${s.ref}|${s.alt ?? planned.get(s.id)?.alt ?? ""}`;
  const left = new Set(scan(root).slots.filter((s) => s.ref).map(key));
  const unwired = report.slots.filter((s) => s.status.startsWith("PASS") && s.ref && left.has(key(s)));
  for (const s of unwired) console.log(`${s.id}: passed but ${s.file} still points at ${s.ref}`);
  const code = cmdCheck(root);
  return unwired.length ? 2 : code;
}

function cmdDoctor() {
  const ok = (label, pass, hint) => { console.log(`${pass ? "ok  " : "MISSING"} ${label}${pass ? "" : ` — ${hint}`}`); return pass; };
  const has = (cmd) => { try { execFileSync(cmd, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } };
  const node = ok(`Node ${process.versions.node}`, Number(process.versions.node.split(".")[0]) >= 18, "Node 18+ is needed");
  const ff = ok("ffmpeg and ffprobe", has("ffmpeg") && has("ffprobe"), "install ffmpeg; the checks read pixels with it");
  const mode = createTransport().mode();
  const auth = ok(`Pollinations sign-in (${mode ?? "none"})`, Boolean(mode),
    "run `npm i -g @pollinations/cli` then `polli auth login`, or set POLLINATIONS_API_KEY");
  return node && ff && auth ? 0 : 1;
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  const root = resolve(opts._[0] ?? ".");
  switch (cmd) {
    case "doctor": return cmdDoctor();
    case "scan": {
      const plan = scan(root);
      const file = join(workDir(root), "plan.json");
      if (existsSync(file) && !opts.force) throw new Error(".made-to-measure/plan.json exists; pass --force to replace it");
      writeJson(file, plan);
      console.log(`${plan.slots.length} slots → .made-to-measure/plan.json. Brand colours: ${plan.brand.colors.join(" ") || "none found"}. Check width, height, path and text zones before \`plan\`.`);
      for (const s of plan.slots) console.log(`  ${s.id}  ${s.width ?? "?"}x${s.height ?? "?"}  ${s.file}:${s.line}  → ${s.path}`);
      return 0;
    }
    case "plan": await cmdPlan(root, opts); return 0;
    case "make": return cmdMake(root, opts);
    case "one": {
      const subject = opts._[0];
      const [w, h] = String(opts.size ?? "1200x630").split("x").map(Number);
      const out = opts.out ?? "made-to-measure.jpg";
      const here = process.cwd();
      const zone = opts["text-zone"] ? ZONES[opts["text-zone"]] : null;
      if (opts["text-zone"] && !zone) throw new Error(`--text-zone is one of ${Object.keys(ZONES).join(", ")}`);
      writeJson(join(workDir(here), "plan.json"), { project: subject, about: subject,
        brand: { colors: opts.palette ? String(opts.palette).split(",") : [] }, direction: null,
        slots: [{ id: "one", kind: "one", file: null, line: null, ref: null, width: w, height: h, alt: subject,
          context: subject, path: out, subject,
          overlay: zone ? { ...zone, color: opts["text-color"] ?? "#ffffff", large: Boolean(opts.large) } : null, prompt: null }] });
      await cmdPlan(here, opts);
      return cmdMake(here, opts);
    }
    case "check": return cmdCheck(root, Boolean(opts.update));
    case "verify": return cmdVerify(root);
    default:
      console.log("usage: fit.mjs doctor | scan <dir> | plan <dir> | make <dir> | check <dir> [--update] | verify <dir> | one \"<subject>\" --size 1200x630 [--palette \"#hex,#hex\"] [--text-zone left --text-color \"#fff\"] [--out file.jpg]\noptions: --budget <pollen> (0.10) --only <id,id> --no-witness --overwrite --allow-paid --text-model --image-model --image-model-2 --witness-model");
      return cmd ? 1 : 0;
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/").replace(/^\/?/, "/")}` || process.argv[1]?.endsWith("fit.mjs")) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err.message); process.exitCode = 1; });
}
