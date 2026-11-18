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
5. Result: banner PASS (try 4), empty-state PASS, **og FAILED**: on every try
   the witness said the picture showed the banner's subject. The two subjects
   overlap; a stranger cannot tell them apart. The og card was not wired in.
6. Wired in: README.md and docs/index.html point at `docs/banner.jpg` and
   `docs/empty-state.jpg`. No `og:image` was added.
7. `fit.mjs verify` — exit 0.

Total: 0.0372 Pollen over 27 make calls and the plan call.
What the agent should do next: give og a subject the banner cannot match
(say, "lighthouse beam over a calm harbour") and run `make --only og`.
