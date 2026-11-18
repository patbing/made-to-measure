// Calls to Pollinations: the polli CLI when it is installed and signed in,
// otherwise HTTPS with POLLINATIONS_API_KEY. Every call goes through the
// ledger, which refuses a call whose worst case would pass the budget.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://gen.pollinations.ai";

export const DEFAULT_MODELS = {
  text: "openai/gpt-5.4-nano",
  image: "black-forest-labs/flux.1-schnell",
  image2: "tongyi-mai/z-image-turbo",
  witness: "openai/gpt-6-luna",
};

/** Public catalog entry for one model (no key needed). Null when it does not exist. */
export async function modelInfo(id) {
  const res = await fetch(`${API}/v1/models/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`model lookup for ${id} failed: HTTP ${res.status}`);
  return res.json();
}

/** Path to the polli CLI's entry script, run with this Node (no shell, so no injection). */
function findPolli() {
  if (process.env.POLLI_BIN) return existsSync(process.env.POLLI_BIN) ? process.env.POLLI_BIN : null;
  // `npm root -g` has fixed arguments; a shell is needed only because npm is npm.cmd on Windows.
  const root = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" });
  const dir = join(root.stdout?.trim() ?? "", "@pollinations", "cli");
  if (!existsSync(join(dir, "package.json"))) return null;
  const { bin } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const rel = typeof bin === "string" ? bin : bin.polli ?? Object.values(bin)[0];
  return join(dir, rel);
}

export function createTransport({ budget, ledger = [] } = {}) {
  const key = process.env.POLLINATIONS_API_KEY;
  const polliBin = key ? null : findPolli();
  const polli = (args) => execFileSync(process.execPath, [polliBin, ...args],
    { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  const spent = () => ledger.reduce((sum, e) => sum + e.cost, 0);

  let cachedMode;
  function mode() {
    if (cachedMode !== undefined) return cachedMode;
    if (key) return (cachedMode = "https");
    if (!polliBin) return (cachedMode = null);
    const out = spawnSync(process.execPath, [polliBin, "auth", "status", "--json"], { encoding: "utf8" });
    let ok = out.status === 0;
    try { ok = JSON.parse(out.stdout).loggedIn !== false && ok; } catch {}
    return (cachedMode = ok ? "polli" : null);
  }

  /** Runs `fn` if worst-case cost fits the budget; records actual cost, or worst case when unknown or failed. */
  async function call(step, model, worst, fn) {
    if (budget !== undefined && spent() + worst > budget + 1e-9) {
      const err = new Error(`budget: ${step} could cost ${worst.toFixed(4)} and ${spent().toFixed(4)} of ${budget} is spent`);
      err.code = "BUDGET";
      throw err;
    }
    const started = Date.now();
    const entry = { step, model, worst: round(worst), cost: round(worst), ms: 0, ok: false };
    ledger.push(entry);
    try {
      const { value, cost } = await fn();
      entry.ok = true;
      if (cost !== undefined) entry.cost = round(cost);
      return value;
    } finally {
      entry.ms = Date.now() - started;
    }
  }

  async function image({ model, prompt, width, height, seed, out, price }) {
    return call("image", model, price, async () => {
      if (mode() === "polli") {
        polli(["gen", "image", prompt, "--model", model, "--width", String(width), "--height", String(height),
          "--seed", String(seed), "--output", out]);
        return { value: out };
      }
      const url = `${API}/image/${encodeURIComponent(prompt)}?${new URLSearchParams({ model, width, height, seed, nologo: "true" })}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`image HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      return { value: out, cost: price };
    });
  }

  /** Chat call that must return a JSON object. `imageFile` is shown to vision models. */
  async function json({ step, model, system, user, seed, imageFile, pricing, maxTokens = 3000 }) {
    const p = (k) => Number(pricing?.[k] ?? 0);
    const worst = ((system.length + user.length) / 3 + (imageFile ? 2000 : 0)) * Math.max(p("promptTextTokens"), p("promptImageTokens"))
      + maxTokens * p("completionTextTokens");
    return call(step, model, worst, async () => {
      let text;
      let cost;
      if (mode() === "polli") {
        const args = ["gen", "text", user, "--model", model, "--system", system, "--json-response",
          "--reasoning", "low", "--max-tokens", String(maxTokens), "--seed", String(seed), "--no-stream"];
        if (imageFile) args.push("--image", polli(["upload", imageFile]).trim().split(/\s+/).at(-1));
        text = polli(args);
      } else {
        const content = imageFile
          ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${readFileSync(imageFile).toString("base64")}` } }]
          : user;
        const res = await fetch(`${API}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, seed, max_tokens: maxTokens, reasoning_effort: "low",
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content }] }),
        });
        if (!res.ok) throw new Error(`${step} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = await res.json();
        text = body.choices?.[0]?.message?.content ?? "";
        const u = body.usage;
        if (u) cost = u.prompt_tokens * Math.max(p("promptTextTokens"), p("promptImageTokens")) + u.completion_tokens * p("completionTextTokens");
      }
      return { value: parseJson(text), cost };
    });
  }

  return { mode, image, json, ledger, spent };
}

/** First {...} object in a model reply. Throws when there is none. */
export function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`no JSON object in reply: ${text.slice(0, 120)}`);
  return JSON.parse(text.slice(start, end + 1));
}

const round = (x) => Math.round(x * 1e6) / 1e6;
