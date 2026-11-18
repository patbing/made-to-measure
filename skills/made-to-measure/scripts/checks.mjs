// Pure measurements on image files. No network. Every check reads pixels
// through ffmpeg so JPEG, PNG and WebP all work without npm dependencies.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

/** Pass rules. The plan step also shows these to the model, word for word. */
export const THRESHOLDS = {
  maxUpscale: 2.0, // final size / generated size
  maxKb: 350,
  minDetail: 10, // luminance standard deviation at 64x64
  minContrast: 4.5, // WCAG AA, normal text
  minContrastLarge: 3.0, // WCAG AA, large text
  contrastPercentile: 0.02, // the worst 2% of the text zone decides, so a small bright patch counts
  maxOffPalette: 0.25, // share of colourful pixels far from every brand hue
  hueTolerance: 25, // degrees
  minChroma: 12, // Lab chroma below this counts as neutral
  minDistinct: 5, // dHash bits between two slots
};

const run = (cmd, args) =>
  execFileSync(cmd, args, { maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });

export function probe(file) {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]).toString().trim();
  const [width, height] = out.split("x").map(Number);
  return { width, height, bytes: statSync(file).size };
}

/** RGB24 pixels of `file` (optionally cropped to a zone in fractions) scaled to w x h. */
export function pixels(file, w, h, zone) {
  const filters = [];
  if (zone) {
    filters.push(`crop=iw*${zone.w}:ih*${zone.h}:iw*${zone.x}:ih*${zone.y}`);
  }
  filters.push(`scale=${w}:${h}:flags=area`);
  return run("ffmpeg", ["-v", "error", "-i", file, "-vf", filters.join(","),
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function toLab([r, g, b]) {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const rgbAt = (buf, i) => [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
const count = (buf) => buf.length / 3;

/** Luminance spread: near 0 for a blank or flat picture. */
export function detail(buf) {
  const n = count(buf);
  const ys = Array.from({ length: n }, (_, i) => {
    const [r, g, b] = rgbAt(buf, i);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  });
  const mean = ys.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(ys.reduce((a, y) => a + (y - mean) ** 2, 0) / n);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Contrast of text colour against the zone: the low 10% of per-pixel ratios. */
export function zoneContrast(buf, textHex, alpha = 0, scrimRgb = [0, 0, 0]) {
  const text = hexToRgb(textHex);
  const ratios = Array.from({ length: count(buf) }, (_, i) => {
    const px = rgbAt(buf, i).map((c, k) => alpha * scrimRgb[k] + (1 - alpha) * c);
    return contrastRatio(px, text);
  });
  return percentile(ratios, THRESHOLDS.contrastPercentile);
}

/** Smallest opacity of a dark (or light, for dark text) scrim that makes the zone pass. */
export function minimumScrim(buf, textHex, target) {
  const scrimRgb = luminance(hexToRgb(textHex)) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  if (zoneContrast(buf, textHex, 1, scrimRgb) < target) return null;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (zoneContrast(buf, textHex, mid, scrimRgb) >= target) hi = mid;
    else lo = mid;
  }
  return { alpha: Math.ceil(hi * 100) / 100, rgb: scrimRgb };
}

const hueOf = ([, a, b]) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const chromaOf = ([, a, b]) => Math.hypot(a, b);
const hueGap = (x, y) => Math.min(Math.abs(x - y), 360 - Math.abs(x - y));

/** Share of colourful pixels whose hue is far from every colourful brand colour. */
export function offPalette(buf, brandHexes) {
  const hues = brandHexes.map((h) => toLab(hexToRgb(h)))
    .filter((lab) => chromaOf(lab) >= THRESHOLDS.minChroma).map(hueOf);
  let colourful = 0;
  let off = 0;
  for (let i = 0; i < count(buf); i++) {
    const lab = toLab(rgbAt(buf, i));
    if (chromaOf(lab) < THRESHOLDS.minChroma) continue;
    colourful++;
    if (!hues.some((h) => hueGap(h, hueOf(lab)) <= THRESHOLDS.hueTolerance)) off++;
  }
  return colourful ? off / colourful : 0;
}

/** 64-bit difference hash from a 9x8 grey thumbnail, as a hex string. */
export function dhash(file) {
  const buf = pixels(file, 9, 8);
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const g = (i) => buf[i * 3] + buf[i * 3 + 1] + buf[i * 3 + 2];
      bits += g(y * 9 + x) > g(y * 9 + x + 1) ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}

/** Crop-to-fill `src` into exactly w x h and encode under maxKb (JPEG quality ladder). */
export function fitTo(src, out, w, h, maxKb = THRESHOLDS.maxKb) {
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;
  const png = /\.png$/i.test(out);
  for (const q of png ? [null] : [2, 3, 4, 6, 8, 10, 13]) {
    const quality = png ? [] : ["-q:v", String(q)];
    run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", vf, ...quality, "-frames:v", "1", out]);
    if (statSync(out).size <= maxKb * 1024) break;
  }
  return probe(out);
}

/**
 * Every code check for one slot. `slot` comes from plan.json:
 * { width, height, max_kb?, overlay?: {x,y,w,h,color,large}, }, brand colours from the plan.
 */
export function measure(file, slot, brandColors = [], generated) {
  const t = THRESHOLDS;
  const p = probe(file);
  const results = [];
  const add = (name, value, pass, rule) => results.push({ name, value, pass, rule });
  const upscale = generated
    ? Math.max(slot.width / generated.width, slot.height / generated.height) : 1;
  add("size", `${p.width}x${p.height}`, p.width === slot.width && p.height === slot.height
    && upscale <= t.maxUpscale, `exactly ${slot.width}x${slot.height}, upscaled at most ${t.maxUpscale}x`);
  const maxKb = slot.max_kb ?? t.maxKb;
  add("weight", Math.round(p.bytes / 1024), p.bytes <= maxKb * 1024, `at most ${maxKb} KB`);
  const d = detail(pixels(file, 64, 64));
  add("detail", round(d), d >= t.minDetail, `luminance spread at least ${t.minDetail}`);
  let scrim = null;
  if (slot.overlay) {
    const min = slot.overlay.large ? t.minContrastLarge : t.minContrast;
    const zone = pixels(file, 48, 48, slot.overlay);
    const c = zoneContrast(zone, slot.overlay.color);
    add("contrast", round(c), c >= min,
      `${slot.overlay.color} text over the zone: low ${t.contrastPercentile * 100}% at least ${min}:1`);
    if (c < min) scrim = minimumScrim(zone, slot.overlay.color, min);
  }
  if (brandColors.length) {
    const off = offPalette(pixels(file, 64, 64), brandColors);
    // Advisory: in the pilot, navy rated "off" for a teal brand; hue distance alone does not separate on- from off-brand.
    add("palette", round(off), off <= t.maxOffPalette,
      `advisory: at most ${t.maxOffPalette * 100}% of colourful pixels off the brand hues`);
    results.at(-1).advisory = true;
  }
  return { results, pass: results.every((r) => r.pass || r.advisory), scrim, hash: dhash(file) };
}

const round = (x) => Math.round(x * 100) / 100;
