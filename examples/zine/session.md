# Session: Night Shift (dark event page)

1. `fit.mjs scan examples/zine/after` — 6 slots: five picsum.photos images and
   no `og:image`. Brand: `#0f0a1e #a21caf #f59e0b #f5f5f4`.
2. The agent corrected `plan.json`: ids, paths under `img/`, and the white
   title over the bottom 40% of the hero:
   `overlay: {x: 0, y: 0.6, w: 1, h: 0.4, color: "#ffffff", large: true}`.
3. `fit.mjs plan` — 0.0010 Pollen.
4. `fit.mjs make` — folding (try 3) and comics (try 2) passed; the rest were
   rejected by the palette rule, then a gate. After it was made advisory,
   `fit.mjs make --only hero,riso,tote,og` reran four slots.
5. Result: hero PASS (try 4, title contrast 11.43:1), riso PASS (try 5), og PASS
   (try 4, the second image model), **tote FAILED**: five of six tries had
   lettering on the stickers and the last one lost the tote bag. It keeps its
   picsum placeholder.
6. Wired in: four picsum URLs replaced by `img/*.jpg`, `og:image` meta added.
7. `fit.mjs verify` — exit 0. (Verify first flagged riso, folding and comics as
   still unwired because the failed tote uses the same picsum URL; verify now
   matches on file, URL and alt text, with a test.)

Total: 0.0632 Pollen over 51 make calls and the plan call.
