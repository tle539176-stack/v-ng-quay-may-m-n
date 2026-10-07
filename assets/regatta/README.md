# SECI Regatta Visual Kit

Artwork for the boat race and the wheel with no seasonal reference. The
chrome is deliberately a calm cool blue so the ten vivid team colours stay
the loudest thing on screen; red is reserved for primary actions.

## The shore scrolls

A moving river next to a frozen bank reads as a treadmill, so the scene is
split into two layers that scroll at different speeds while `.race-board`
carries `is-racing`: `scene-far.svg` (hills, clouds) drifts slowly and
`scene-near.svg` (trees, boathouse, bridge, bank) drifts about two and a half
times faster.

Each layer is a strip of two identical tiles, `width: 200%`, animated to
`translate3d(-50%, 0, 0)` — exactly one tile — so the loop hands off
invisibly. That only works because both SVGs are horizontally seamless: the
bank is a flat band, the hill and sand curves have periods that divide 2172
exactly, and no tree or building crosses either edge. Both carry
`preserveAspectRatio="none"` so `background-size: 100% 100%` stretches them
to the tile with no letterboxing that would misalign the seam.

Under `prefers-reduced-motion: reduce` both layers stop.

## There is no logo file

Every logo slot — the brand mark, the race header, both banners and the wheel
hub — shows the single image the user uploads through the brand mark button.
`renderLogo()` in `index.html` writes that one data URI into every element
marked `data-logo-slot`. With no upload the slots hide themselves and fall
back to plain text, never to drawn artwork.

## The boat is not a file

Unlike every other asset here, the boat sprite lives in `index.html` as the
`BOAT_SPRITE` template string, inlined into each lane by `renderRaceBoard`.
It has to be inline: an SVG loaded through `<img src>` is an isolated
document, so the page's `--race-team-color` cannot reach inside it. Inlining
lets each hull, prow and pennant paint itself with its own team colour.

Each lane also gets `--race-team-ink`, computed by `teamInk()` in
`index.html`: it compares the WCAG contrast of white versus deep ink against
that team's colour and picks the winner, so the name tag stays readable on
both `#ffc400` and `#2563ff`.

The four seats carry the team's own members as circular photos, falling back
to an initial when someone has no picture. Faces are the point of the boat, so
the mid-hull mast was dropped to clear room for them and the sprite viewBox is
cropped tight to the hull rather than padded out to a round 640x320.

## Integration map

| Asset | Used by |
| --- | --- |
| `scene-far.svg` | `.race-scene-far` parallax layer, slow |
| `scene-near.svg` | `.race-scene-near` parallax layer, fast |
| `bunting.svg` | `.race-header::after`, `.wheel-area::before`, `.result-modal` |
| `skyline.svg` | `.wheel-area` and `.result-modal::before` silhouette |
| `finish-gate.svg` | `.race-finish-line > img` |
| `banner.svg` | `.result-festival-banner` backdrop |
| `water-track-seamless.svg` | `.race-track` background, `repeat-y` |
| `water-wake.svg` | `.race-boat::before` |
| `water-caustics.svg` | `.race-empty` |

## Palette

CSS custom properties in `race-ui.css`: `--seci-ink-950/900`,
`--seci-blue-800`, `--seci-blue`, `--seci-blue-bright`, `--seci-accent`
(yellow), `--seci-red`, `--seci-red-deep`, `--seci-paper`, plus the
`--race-water*` ramp. Team colours live in the `COLORS` array in
`index.html`.

## Notes

- `water-track-seamless.svg` tiles vertically: the ripple pattern has a
  100 px period and the 600 px canvas is an exact multiple, so the seam
  between repeats is invisible. It is kept deliberately plain — a busy
  water texture would compete with ten saturated boats.
- Earlier kits remain in `assets/autumn/` and `assets/national-day/` and are
  no longer referenced by any file.
