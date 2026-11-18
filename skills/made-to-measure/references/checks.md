# The checks

All checks are plain code in `scripts/checks.mjs`. Pixels come from ffmpeg
(`-f rawvideo -pix_fmt rgb24`), so JPEG, PNG and WebP all work. Every rule
lives in one `THRESHOLDS` object, which the plan step also shows to the text
model word for word.

## size
`ffprobe` reads the final file. It must equal the slot exactly. The picture is
generated near the slot's aspect (long side 768–1536, multiples of 16) and
cropped to fill, so the upscale factor (slot / generated) is recorded and must
be at most 2.

## weight
The final file is encoded with a JPEG quality ladder (`-q:v` 2, 3, 4, 6, 8, 10, 13)
until it is at most `max_kb` (default 350 KB). PNG slots are encoded once.

## detail
Standard deviation of luminance at 64×64. Under 10 means a blank, flat or
nearly single-colour picture.

## contrast
Only for slots with an `overlay` (text drawn on the picture). The text zone is
cropped and scaled to 48×48. Each pixel's WCAG contrast ratio against the text
colour is computed with the WCAG relative-luminance formula, and the 2nd
percentile must reach 4.5:1 (3:1 for large text). The 2nd percentile, not
the mean, means a bright patch behind a word counts.

When contrast is the only failure, the script finds the smallest opacity of a
black (for light text) or white (for dark text) overlay that makes the zone
pass, by bisection on the same formula. The slot can then pass as
`PASS WITH SCRIM`, and the report gives that opacity.

## palette
Only when the plan has `brand.colors`. Pixels at 64×64 are converted to CIE Lab.
Pixels with chroma under 12 are neutral and never count. Of the colourful
pixels, at most 25% may have a hue more than 25° from every colourful brand
colour.

**Advisory, not a gate.** The report shows it as a note and the picture still
passes. In the pilot this rule rejected 16 tries; shown to the witness later,
8 of them were clean pictures of the right subject (a navy night sky counted as
"off" for a teal brand). Hue distance alone does not separate on-brand from
off-brand, so the plan asks the image model for brand hues and the person decides.

## distinct
A 64-bit difference hash (9×8 grey thumbnail). A slot's picture must differ from
every slot that passed before it by at least 5 bits.

## witness
A second model (`openai/gpt-6-luna` by default) sees only the finished picture,
never the prompt, and answers yes or no, in shuffled order:
- Is the main subject: <this slot's subject>?
- Is the main subject: <another slot's subject>? (a decoy)
- Does it contain readable words, letters, numbers, a logo or a watermark?

Passing is yes, no, no. A "yes" to the decoy means the witness is not reliable
for that picture, and the slot is `UNVERIFIED`, never passed.
