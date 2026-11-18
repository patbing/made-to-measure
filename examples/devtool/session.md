# Session: tidewater (CLI tool README and docs page)

1. `fit.mjs scan examples/devtool/after` — 3 slots: `docs/banner.png` and
   `docs/empty-state.png` do not exist (referenced from README.md and
   docs/index.html), and docs/index.html has no `og:image`.
2. The agent corrected `plan.json`: ids `banner`, `og`, `empty-state`; both
   pictures as `.jpg` (photographic, smaller); the empty-state image had no size
   in Markdown, so the agent set 960×540 from the docs layout.
3. `fit.mjs plan` — 0.0007 Pollen. Subjects from the model: banner "folder-to-S3
   sync flow", og "watcher syncing uploads", empty-state "empty harbour at low tide".
4. `fit.mjs make` — first run: empty-state PASS on try 3; banner and og failed.
   At the time the palette rule was a gate and rejected a navy sea for a teal
   brand. Palette was made advisory (see `references/checks.md`) and
   `fit.mjs make --only banner,og` reran the two slots, keeping earlier attempts.
5. Result: banner PASS (try 4), empty-state PASS, **og FAILED**: on all four
   tries that reached the witness (2, 4, 5, 6) it said the picture showed the
   banner's subject. Tries 1 and 3 had stopped at the palette rule. The two
   subjects overlap; a stranger cannot tell them apart.
6. The agent changed og in `plan.json`: subject "lighthouse beam over a calm
   harbour" and a prompt that rules out folders, cables and buckets.
   `fit.mjs make --only og --budget 0.015` — PASS on try 7, the first try of the
   new subject.
7. Wired in: README.md and docs/index.html point at `docs/banner.jpg` and
   `docs/empty-state.jpg`; docs/index.html got `og:image` → `og.jpg`.
8. `fit.mjs verify` — exit 0.

Total: 0.0393 Pollen over 29 make calls and the plan call.
