# Component artwork

Three generations live here:

- `svg/*.svg` — original vector artwork drawn for this plugin in the palette and
  style of the Finesse-visualization canvas (GPL-3.0 project): dark metal
  housings, glass optics, colored accents, no baked shadows so rotated icons
  stay clean.
- `hd/*.png` — the same vector artwork rasterized at 512 px (longest side),
  flattened on white. The renderer prefers these files.
- `*.png` (top level) — the original 9–62 px component bitmaps from
  Finesse-visualization, kept as a fallback when `hd/` is missing.

The renderer selects `hd/<name>.png` first, then the legacy bitmap, then a
vector placeholder (Gauss waist, unknown types).

Upstream reference: Finesse-visualization, GPL-3.0.
