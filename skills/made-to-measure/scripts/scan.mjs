// Finds empty image slots in a project: placeholder-service URLs, image paths
// that do not exist, and HTML pages without an og:image. Writes nothing.
// shortcut: regex scan, not a parser; the agent corrects plan.json. Upgrade if a framework's image syntax is missed often.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const TEXT_EXT = new Set([".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".astro", ".md", ".mdx", ".css"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".made-to-measure", "out"]);
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const PLACEHOLDER = /https?:\/\/(?:www\.)?(placehold\.co|via\.placeholder\.com|placeholder\.com|picsum\.photos|dummyimage\.com|placekitten\.com|fakeimg\.pl|loremflickr\.com)\/[^\s"'`)<>]*/gi;
const LOCAL_REF = /(?:src|href|content)\s*=\s*["']([^"'#?]+?\.(?:jpe?g|png|webp|gif|avif))["']|url\(\s*["']?([^"')#?]+?\.(?:jpe?g|png|webp|gif|avif))["']?\s*\)|!\[[^\]]*\]\(\s*([^)\s]+?\.(?:jpe?g|png|webp|gif|avif))/gi;

function* files(root, dir = root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* files(root, join(dir, entry.name));
    } else if (TEXT_EXT.has(extname(entry.name).toLowerCase())) {
      const full = join(dir, entry.name);
      if (statSync(full).size <= 1 << 20) yield full;
    }
  }
}

/** Width and height from a placeholder URL: 800x600, 800/600 or a single square size. */
export function sizeFromUrl(url) {
  const path = new URL(url).pathname;
  const m = path.match(/(\d{2,4})\s*[x×/]\s*(\d{2,4})/) ?? path.match(/\/(\d{2,4})(?:\/|$)/);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2] ?? m[1]) };
}

/** The tag around position `i` in `text` (for width/height/alt attributes). */
function tagAround(text, i) {
  const start = text.lastIndexOf("<", i);
  const end = text.indexOf(">", i);
  return start >= 0 && end > i && end - start < 2000 ? text.slice(start, end + 1) : "";
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*[{"']?([^"'}\\s>]+)`, "i"))?.[1];

function nearestHeading(text, i) {
  const before = text.slice(Math.max(0, i - 4000), i);
  const html = [...before.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].at(-1)?.[1];
  const md = [...before.matchAll(/^#{1,3}\s+(.+)$/gm)].at(-1)?.[1];
  return (html ?? md ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

const lineOf = (text, i) => text.slice(0, i).split("\n").length;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";

/** Brand colours: hex values in CSS custom properties, most used first. */
export function brandColors(cssTexts) {
  const counts = new Map();
  for (const css of cssTexts) {
    for (const m of css.matchAll(/--[\w-]+\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)) {
      const hex = m[1].toLowerCase();
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).slice(0, 6);
}

export function scan(rootDir) {
  const root = resolve(rootDir);
  const slots = [];
  const css = [];
  const ids = new Set();
  const uniqueId = (base) => {
    let id = slug(base);
    for (let n = 2; ids.has(id); n++) id = `${slug(base)}-${n}`;
    ids.add(id);
    return id;
  };
  for (const file of files(root)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(root, file).split(sep).join("/");
    if (/\.(css|vue|svelte|astro|html?)$/i.test(file)) css.push(text);
    const base = (i, ref, kind, size) => {
      const tag = tagAround(text, i);
      const width = Number(attr(tag, "width")) || size?.width || null;
      const height = Number(attr(tag, "height")) || size?.height || null;
      const alt = attr(tag, "alt") ? tag.match(/\balt\s*=\s*["']([^"']*)/i)?.[1] ?? "" : "";
      const context = nearestHeading(text, i);
      const id = uniqueId(alt || context || kind);
      return { id, kind, file: rel, line: lineOf(text, i), ref, width, height, alt, context,
        path: null, overlay: null, subject: null, prompt: null };
    };
    for (const m of text.matchAll(PLACEHOLDER)) {
      const slot = base(m.index, m[0], "placeholder", sizeFromUrl(m[0]));
      slot.path = `assets/${slot.id}.jpg`;
      slots.push(slot);
    }
    for (const m of text.matchAll(LOCAL_REF)) {
      const ref = m[1] ?? m[2] ?? m[3];
      if (/^(https?:|data:|\/\/)/i.test(ref) || !IMG_EXT.test(ref)) continue;
      const candidates = ref.startsWith("/")
        ? [join(root, ref), join(root, "public", ref)]
        : [resolve(dirname(file), ref)];
      if (candidates.some(existsSync)) continue;
      const target = relative(root, candidates.at(-1)).split(sep).join("/");
      if (target.startsWith("..")) continue;
      const slot = base(m.index, ref, "missing");
      slot.path = target.replace(/\.(gif|avif)$/i, ".jpg");
      slots.push(slot);
    }
    if (/\.html?$/i.test(file) && /<head[\s>]/i.test(text) && !/og:image/i.test(text)) {
      const i = text.search(/<head[\s>]/i);
      const title = text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
      const id = uniqueId(`og-${title || rel}`);
      slots.push({ id, kind: "og", file: rel, line: lineOf(text, i), ref: null, width: 1200, height: 630,
        alt: "", context: title, path: `${dirname(rel) === "." ? "" : `${dirname(rel)}/`}og.jpg`,
        overlay: null, subject: null, prompt: null });
    }
  }
  return { project: root.split(sep).at(-1), brand: { colors: brandColors(css) }, direction: null, slots };
}
