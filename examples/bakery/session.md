# Session: Crumb & Ember (bakery landing page)

The coding agent was Claude Code with this skill installed. Commands are from
the project root; the skill folder is `skills/made-to-measure/`.

1. `fit.mjs doctor` — Node, ffmpeg and the Pollinations sign-in found.
2. `fit.mjs scan examples/bakery/after` — 5 slots: four placehold.co images and
   no `og:image`. Brand colours from the CSS variables: `#c2410c #78350f #fef3c7 #1c1917`.
3. The agent read `index.html` and `css/site.css`, then corrected `plan.json`:
   - shorter ids (`hero`, `rye`, `country`, `buns`, `og`) and paths under `img/`;
   - the hero headline is large white text over the left 45% of the picture, so
     `overlay: {x: 0, y: 0, w: 0.45, h: 1, color: "#ffffff", large: true}`.
4. `fit.mjs plan` — one art direction ("pre-dawn wood-fired glow, film grain")
   and a prompt per slot. Plan call: 0.0010 Pollen.
5. `fit.mjs make` — 5 PASS on the first try, 10 calls, 0.0105 Pollen.
   Hero: 1344×768, 66 KB, white text 8.02:1 over the worst 2% of the zone.
6. Wired in: placehold.co URLs replaced by `img/*.jpg` (width, height and alt
   kept), `og:image` meta added.
7. `fit.mjs verify` — "Every measurement in the report reproduces." exit 0.

Total: 0.0115 Pollen. Files: `.made-to-measure/` (plan, report, receipt, every attempt).
