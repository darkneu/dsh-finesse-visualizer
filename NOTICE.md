# Notices and attribution

This package is licensed GPL-3.0-only. It includes or depends on the following
work:

- **Component artwork** — the optical component icons in `assets/components/`
  are derived from [Finesse-visualization](https://github.com/leelans/Finesse-visualization)
  (GPL-3.0): the original bitmaps are kept as a fallback and the `svg/` and
  `hd/` artwork is a vector redraw in the same style. Those files remain under
  GPL-3.0, which is why the whole package is GPL-3.0.
- **Finesse 3** — the simulation engine ([finesse.ifosim.org](https://finesse.ifosim.org/),
  GPL-3.0) is a runtime dependency used through the user's own Python
  environment. It is not bundled in this package.
- The remaining plugin code (Host half, Web half, Python renderer) is original
  work for this package and is licensed GPL-3.0-only.
