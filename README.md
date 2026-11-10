# Finesse visualizer — DSH plugin

Detects Finesse 3 KatScript in a conversation and renders it as figures in the
turn card, without being asked: optical layout, Gaussian beam trace, detector
readout/sweep and CCD intensity.

## Install

Requires DSH `>=0.2.1-rc.2` and a Python interpreter that can `import finesse`
(Finesse 3, NumPy, Matplotlib).

```sh
# npm
dsh plugin --profile <profile> add dsh-finesse-visualizer

# or from the GitHub release tarball (no npm account needed)
dsh plugin --profile <profile> add https://github.com/darkneu/dsh-finesse-visualizer/releases/latest/download/dsh-finesse-visualizer.tgz
```

A local checkout can be handed to the DSH plugin manager directly. After the
first install, refresh the Web page once: the left sidebar gains **Finesse 设计器**,
and Finesse/KatScript in a conversation renders as a card at the end of its turn.

## What it does

1. The Host half listens to committed `session/event` messages.
2. A message that contains KatScript (two or more component lines, or one
   component plus an `xaxis`/`noxaxis` analysis) or a Python cell that builds a
   Finesse model starts a render in the background.
3. The bundled Python renderer parses and runs the model with the installed
   Finesse 3 and writes PNGs under `~/.dsh/finesse-vis/<session>/<item>/`.
4. The Web half registers `conversation.chat.turnTail` and shows the figures of
   that Turn, polling while the render is still running.

Supported inputs:

- KatScript: `l`, `s`, `m`, `bs`, `lens`, `mod`, `isol`, `pd`, `ad`, `ccd`,
  `cav`, `gauss`, `telescope`, `xaxis`, `x2axis`, `noxaxis`.
- Jupyter-style cells: `name = 1e-3` variables plus `model.parse("""...""")`.
  `{var}` placeholders are resolved, `numpy` expressions are not executed.
- Legacy spaces that lead to a detector are dropped, because Finesse 3 attaches
  detectors to an optical node.

## Visual designer

The plugin adds a left-sidebar entry **Finesse 设计器** (global, no Session
needed) plus a compact **Finesse 设计器** pill in the composer dock. Either one
opens the same drag-and-drop bench:

- drag a component from the palette onto the canvas, or click it to place one;
- drag a component body to move it;
- drag from a red port dot to another port to connect the two components;
  a photodetector or CCD connects as a leaf and draws a dashed link;
- select a component to edit its name and parameters (`R`, `T`, `Rc`, `f`,
  `midx`, …), select a link to edit its length `L`; Delete removes the selection;
- the KatScript panel below regenerates on every change, and **复制代码** copies
  it — pasting that code into the chat runs it through the auto-visualizer above;
- **迈克尔逊示例** loads a ready-made Michelson (laser, beamsplitter, two
  mirrors, photodetector).

The designer is hand-written plain JavaScript with inline vector glyphs, so it
needs no build step and no extra asset route.

## 2D layout

The layout is inferred from the Finesse model rather than from hand-placed
coordinates:

- The laser is placed at the origin and sends its beam east.
- A space continues straight; a lens, modulator or isolator transmits straight.
- A mirror sends the transmitted beam straight through; for a folding
  beamsplitter (`T ≈ 0`) the beam turns 90° toward the perpendicular branch.
- A beamsplitter branches its children at 90°: transmission straight, reflection
  perpendicular (one child per side, so two branches never land on the same side).
- A cavity or ring connection that closes a loop is routed as a Manhattan bend.
- Detectors and Gauss markers sit downstream of their component (or beside it
  when the downstream cell is taken) and are joined by dashed stubs; a static
  `noxaxis` run labels each photodetector with its value and unit.

Component artwork is also oriented from the same beam directions:

- a mirror is drawn perpendicular to its beam (vertical for a horizontal beam,
  horizontal for a vertical one);
- a beamsplitter plate is rotated 45° so its diagonal matches the actual turn
  (east→north and north→east use one diagonal, east→south the other);
- a photodetector's flat sensitive face points back at the incoming beam;
- a lens, modulator or isolator has its optical axis along the beam, the laser
  points along its output, and the Gauss marker is rotated with the beam.

Mirrors carry both coatings visually: the HR face has a bright silver-blue
coating, the AR face a green anti-reflection coating, and the layout also draws
a blue/green bar on each face plus an HR/AR legend. The HR face is turned toward
the cavity side — the side from which more components are reachable — so an
input mirror's HR faces the PRC and an end mirror's HR faces its arm.

Link lengths are drawn on a log scale (1.75–5.4 layout units) and labelled with
the physical length (`12.5 m`, `25 m`, `25 km`). A linear scale would make the
12.5 m links invisible next to the 25 km arms; zero-length links keep the
minimum spacing.

This produces the expected Michelson picture: laser → input mirror → beamsplitter,
the two arms at right angles, the ITM/recombination corner, the dark port, and the
two 25 km arm directions as perpendicular branches.

## Figures

| File | Content |
|---|---|
| `finesse-layout.png` | 2D optical bench drawn with the Finesse-visualization component artwork (laser, mirror, beamsplitter, lens, EOM, isolator, photodetector, CCD), with beam-direction routing, port dots and detector readouts; vector-redrawn 512 px component artwork instead of the original 23 px bitmaps |
| `finesse-beam.png` | Gaussian beam radius `w` along the real propagation path |
| `finesse-outputs.png` | Detector readout table (`noxaxis`) or sweep curves (`xaxis`) |
| `finesse-ccd.png` | CCD field intensity when the model has a `ccd` |

A render error is shown in the card with the KatScript line and caret from the
Finesse parser, which makes the plugin useful for debugging pasted scripts too.

## Requirements

A Python interpreter that can `import finesse` (Finesse 3), plus `numpy` and
`matplotlib`. The plugin probes, in order:

1. `FINESSE_VIZ_PYTHON`
2. `FINESSE_PYTHON`
3. `$CONDA_PREFIX/bin/python`
4. `~/miniconda3/envs/finesse_sim/bin/python`
5. `~/anaconda3/envs/finesse_sim/bin/python`
6. `/opt/anaconda3/envs/finesse_sim/bin/python`
7. `/opt/anaconda3/bin/python3`, `/opt/homebrew/bin/python3`, `python3`, `python`

The first interpreter whose `import finesse` succeeds is cached for the session.

## Files

```
index.js                 Host half: detection, render queue, HTTP routes
client.js                Web half: the turn card and the drag-and-drop designer
python/render_finesse.py KatScript normalization, model run, matplotlib figures
assets/components/       Component artwork: original SVG in the project's style, 512 px rasterized HD PNGs, legacy bitmaps as fallback
cordis.patch.yml         One process-wide Host row
locale/{en,zh}.json      Plugin Manager title and description
icon.svg                 Plugin icon
```

## HTTP routes

Both are served on the Web GUI origin; the page's existing cookie authenticates
them.

- `GET /finesse-vis/turn?sessionId=<id>&turn=<n>` → `{ items: [...] }`
- `GET /finesse-vis/image/<session>/<item>/<file>.png` → PNG bytes

## Tuning

- `FINESSE_VIZ_TIMEOUT_MS`  render deadline (default `180000`)
- `FINESSE_VIZ_PYTHON`      interpreter override
- `DSH_HOME`                output root (default `~/.dsh`)

Detection is deliberately conservative: at most two code blocks per message and
three rendered models per Turn, deduplicated by normalized source text.

## Limits

- Only text messages are scanned; images and file attachments are not.
- `numpy`/Python expressions in a pasted cell are not executed, so a cell that
  computes parameters with arbitrary Python falls back to the KatScript block.
- The renderer runs the model as given: a pathological sweep is bounded by the
  render deadline, not by a sandbox.

## License

GPL-3.0-only. The component artwork is derived from
[Finesse-visualization](https://github.com/leelans/Finesse-visualization)
(GPL-3.0); see [NOTICE.md](NOTICE.md).
