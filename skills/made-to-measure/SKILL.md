---
name: made-to-measure
description: Fills the empty image slots in a project with pictures made by Pollinations models and measured by code before they are wired in. Finds placeholder images, broken image paths and missing social cards, sets one art direction from the project's own copy and colors, generates each picture at the slot's exact size, then measures dimensions, file weight, text contrast over the picture, palette and subject, and repairs what fails. Use when the user asks for a hero image, illustrations, an OG or social card, a README banner, placeholder replacement or on-brand pictures for a page, site or README, or when a project still points at placehold.co, picsum, via.placeholder or image files that do not exist.
license: MIT
compatibility: Requires Node.js 18+, ffmpeg and ffprobe on PATH, network access, and the polli CLI (npm i -g @pollinations/cli) signed in, or POLLINATIONS_API_KEY.
allowed-tools: Bash(node:*) Bash(polli:*) Bash(ffmpeg:*) Bash(ffprobe:*) Read Edit
metadata:
  author: patbing
  version: "0.1.0"
---

# Made to Measure

You fill a project's empty picture slots. Pollinations models choose the art
direction and draw; plain code measures every picture against what the
project's own code says the slot needs, and only pictures that pass go in.

## What good looks like

- Each picture is exactly the slot's width and height and under its weight limit.
- Where page text sits on a picture, that area is calm and the text meets WCAG contrast.
- One art direction for the whole project, in the project's own colours.
- Someone who never saw the prompt can name what the picture shows, and it has no stray text or logos.
- A picture that does not pass is not wired in. You say so instead.

## Before you start

Run `node scripts/fit.mjs doctor` (paths are relative to this skill's folder).
It checks Node, ffmpeg and the Pollinations sign-in, and costs nothing.

- Not signed in: run `polli auth login` and show the user the URL and code it
  prints. Never ask the user to paste a key into the chat.
- What leaves the machine: slot sizes, alt text and nearby headings, up to
  1,500 characters of the README or main page, brand colours, and each finished
  picture (uploaded so a second model can look at it; `--no-witness` skips this).
  Source files and environment variables are never sent.

## Run it

1. **Find the slots.** `node scripts/fit.mjs scan <project>` writes
   `<project>/.made-to-measure/plan.json`: every placeholder URL, image path that
   does not exist, and HTML page without `og:image`, with file, line, size and
   alt text. It is a regex scan, so read the code it points at.
2. **Correct the plan from the code.** You know the project better than the scan:
   - `width`/`height`: from attributes, CSS or the component. Fill any `null`.
   - `path`: where the picture should live (`public/…` in most frameworks).
   - `overlay`: if text is drawn over the picture, set `{x, y, w, h}` as fractions
     of the picture, the text `color`, and `large: true` for 24px+ or 19px bold text.
   - `brand.colors`: the project's colours, from CSS variables or the theme.
   - Remove slots that should stay empty (icons, logos, user uploads).
3. **Plan.** `node scripts/fit.mjs plan <project>` — the text model writes one art
   direction and a prompt per slot, and the script prints the expected cost
   (first try and worst case). Show the user the direction and the cost. If they
   want changes, edit `direction` and the prompts in `plan.json` directly.
4. **Make.** `node scripts/fit.mjs make <project>` — for each slot: generate,
   crop to the exact size, measure, and repair up to twice (the measured failures
   go back to the text model; the last try uses a second image model).
5. **Read** `.made-to-measure/report.json` (or open `report.html`). Statuses:
   - `PASS` — wire it in.
   - `PASS WITH SCRIM` — only contrast failed; the report gives the smallest
     overlay opacity that passes. Wire the picture in **with** that overlay on the
     text zone.
   - `UNVERIFIED` — the checking model could not be trusted for this slot. Do not
     wire it in; tell the user and offer to rerun that slot.
   - `FAILED`, `NOT ATTEMPTED (…)` — leave the placeholder; say why.
6. **Wire in** passing pictures yourself (the script never edits source): replace
   the placeholder URL or point the reference at `path`, keep `width`, `height`
   and `alt` on `<img>`, add `<meta property="og:image">` for social cards.
7. **Verify.** `node scripts/fit.mjs verify <project>` rescans for slots that passed
   but are still placeholders and re-measures every picture on disk. Then report:
   slots filled, repairs, anything left, and the Pollen spent (from the report).

No project? `node scripts/fit.mjs one "a lighthouse in fog" --size 1200x630 --text-zone left --text-color "#ffffff"`
makes one measured picture in the current folder.

## The checks

| Check | Measured by code | Passes when |
|---|---|---|
| size | ffprobe on the final file | exactly the slot size, upscaled at most 2× |
| weight | file bytes after the JPEG quality ladder | at most 350 KB (or the slot's `max_kb`) |
| detail | luminance spread at 64×64 | at least 10 (not blank or flat) |
| contrast | each text-zone pixel against the text colour, WCAG formula | the worst 2% of pixels still reach 4.5:1 (3:1 large) |
| palette (note only) | Lab hue of colourful pixels | reported, never blocks: at most 25% more than 25° from every brand hue |
| distinct | 64-bit difference hash | differs from every other slot |
| witness | a second model sees only the picture: is it the subject, is it another slot's subject, is there text? | yes, no, no |

Details and formulas: [references/checks.md](references/checks.md).

## Money

- Default models are all free-tier: `openai/gpt-5.4-nano` (direction, repairs),
  `black-forest-labs/flux.1-schnell` (pictures, 0.002 Pollen each),
  `tongyi-mai/z-image-turbo` (last repair, 0.004), `openai/gpt-6-luna` (witness).
- Every model is looked up in the live catalog first; a paid-only model is refused
  unless you pass `--allow-paid`.
- `--budget <pollen>` (default 0.10) stops before any call whose worst case would
  pass it. Failed calls count. Every call is in `.made-to-measure/receipt.json`.
- Five slots cost about 0.012 Pollen when everything passes first time.

## Pitfalls

- Image models add text when asked not to. The witness catches it; repairs say
  "no lettering" again with the measured failure.
- Two slots with overlapping subjects ("sync flow" and "syncing uploads") fail
  each other: the witness is also asked about another slot's subject. Give every
  slot a subject a stranger could tell apart before `make`.
- "Leave space for text" is too vague. Say where (left 45%) and how dark.
- Models round sizes to multiples of 16; the script generates near the slot's
  aspect and crops, so never resize the output yourself.
- The same prompt and seed return a cached picture; the script uses a new seed
  for every attempt.
- Existing files are never overwritten without `--overwrite`.

## Files

- `scripts/fit.mjs` — commands: doctor, scan, plan, make, one, check, verify.
- `scripts/checks.mjs` — every measurement and the pass rules (`THRESHOLDS`).
- `scripts/scan.mjs` — the slot finder.
- `scripts/pollinations.mjs` — polli CLI or HTTPS calls, the budget and the receipt.
- `references/checks.md` — what each check measures and why.
