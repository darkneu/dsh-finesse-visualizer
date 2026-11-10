#!/usr/bin/env python3
"""Render Finesse 3 KatScript into a set of publication-ready PNG figures.

Produces (when possible):
  layout.png  - optical layout diagram (components + connections)
  beam.png    - the same layout with a Gaussian beam envelope overlaid
  outputs.png - detector readouts (static values or a sweep)
  ccd.png     - CCD field intensity
  result.json - machine-readable summary used by the Harness plugin
"""
from __future__ import annotations

import argparse
import ast
import json
import math
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import image as mpimg
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Polygon
from matplotlib.transforms import Affine2D

# ---------------------------------------------------------------- palette ----
PALETTE = {
    "laser": "#c0392b",
    "mirror": "#2c6fb5",
    "beamsplitter": "#7d3c98",
    "lens": "#1e8449",
    "modulator": "#b9770e",
    "isolator": "#117a65",
    "photodetector": "#34495e",
    "ccd": "#d35400",
    "amplitude_detector": "#34495e",
    "cavity": "#7f8c8d",
    "gauss": "#7f8c8d",
    "telescope": "#7f8c8d",
    "default": "#566573",
}
TEXT = "#1c2733"
MUTED = "#6b7785"
GRID = "#e3e8ee"
BEAM = "#2c6fb5"

TYPE_NAMES = {
    "Laser": "laser",
    "Mirror": "mirror",
    "Beamsplitter": "beamsplitter",
    "Lens": "lens",
    "Modulator": "modulator",
    "Isolator": "isolator",
    "PowerDetector": "photodetector",
    "AmplitudeDetector": "amplitude_detector",
    "CCD": "ccd",
    "Cavity": "cavity",
    "Gauss": "gauss",
    "Telescope": "telescope",
}

SHORT_LABEL = {
    "laser": "LASER",
    "mirror": "M",
    "beamsplitter": "BS",
    "lens": "LENS",
    "modulator": "EOM",
    "isolator": "ISO",
    "photodetector": "PD",
    "amplitude_detector": "AD",
    "ccd": "CCD",
    "cavity": "CAV",
    "gauss": "GAUSS",
}


ASSET_DIR = Path(__file__).resolve().parent.parent / "assets" / "components"
HD_DIR = ASSET_DIR / "hd"
ICON_MAP = {
    "laser": "laser.png",
    "mirror": "mirror.png",
    "beamsplitter": "beamsplitter.png",
    "lens": "lens.png",
    "modulator": "modulator.png",
    "isolator": "isolator.png",
    "photodetector": "photodetector.png",
    "amplitude_detector": "photodetector.png",
    "ccd": "ccd.png",
}
ICON_HEIGHT = {
    "laser": 0.90,
    "mirror": 1.12,
    "beamsplitter": 0.88,
    "lens": 1.02,
    "modulator": 0.82,
    "isolator": 0.66,
    "photodetector": 0.78,
    "amplitude_detector": 0.78,
    "ccd": 0.72,
}
_ICON_CACHE: dict[str, Any] = {}


def _icon_image(kind: str):
    """Load one bundled component icon, or None when the type has no artwork."""
    if kind in _ICON_CACHE:
        return _ICON_CACHE[kind]
    name = ICON_MAP.get(kind)
    path = None
    if name:
        high = HD_DIR / name
        legacy = ASSET_DIR / name
        path = high if high.is_file() else legacy
    image = None
    if path is not None and path.is_file():
        try:
            image = mpimg.imread(path)
        except Exception:
            image = None
    _ICON_CACHE[kind] = image
    return image


def _icon_size(kind: str, image) -> tuple[float, float]:
    height = ICON_HEIGHT.get(kind, 0.72)
    width = height * image.shape[1] / image.shape[0]
    if width > 1.7:
        width, height = 1.7, 1.7 * image.shape[0] / image.shape[1]
    return width, height


def _icon_box(name: str, kinds: dict, orient: dict | None = None):
    kind = kinds.get(name, "default")
    image = _icon_image(kind)
    if image is not None:
        width, height = _icon_size(kind, image)
    else:
        width, height = _box_size(name)
    angle = abs(((orient or {}).get(name, 0)) % 180)
    if abs(angle - 90) < 1:
        return height, width
    return width, height


def _edge_point(x, y, tx, ty, size):
    """Point where the line from (x,y) toward (tx,ty) leaves the box around (x,y)."""
    w, h = size
    dx, dy = tx - x, ty - y
    if dx == 0 and dy == 0:
        return x, y
    tx_ = (w / 2) / abs(dx) if dx else float("inf")
    ty_ = (h / 2) / abs(dy) if dy else float("inf")
    t = min(tx_, ty_, 1.0)
    return x + dx * t, y + dy * t


def _quantity(value: float, unit: str = "") -> str:
    """Format a detector value with an SI prefix and the detector's unit."""
    magnitude = abs(value)
    if magnitude == 0:
        return f"0 {unit}".strip()
    if magnitude >= 1e6:
        number, prefix = f"{value / 1e6:.3g}", "M"
    elif magnitude >= 1e3:
        number, prefix = f"{value / 1e3:.3g}", "k"
    elif magnitude >= 1:
        number, prefix = f"{value:.4g}", ""
    elif magnitude >= 1e-3:
        number, prefix = f"{value * 1e3:.3g}", "m"
    elif magnitude >= 1e-6:
        number, prefix = f"{value * 1e6:.3g}", "µ"
    else:
        return f"{value:.2e} {unit}".strip()
    return f"{number} {prefix}{unit}".strip()


def _icon_bounds(pos):
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    return min(xs) - 1.05, max(xs) + 1.05, min(ys) - 0.85, max(ys) + 0.55


def _detector_unit(det) -> str:
    kind = type(det).__name__
    if kind == "PowerDetector":
        return "W"
    if kind == "AmplitudeDetector":
        return "√W"
    return ""


DIRECTIONS = ((1, 0), (0, 1), (-1, 0), (0, -1))  # east, north, west, south
LEAF_DIRECTIONS = (
    (0.0, 1.0), (1.0, 0.0), (-1.0, 0.0), (0.0, -1.0),
    (0.707, 0.707), (-0.707, 0.707), (0.707, -0.707), (-0.707, -0.707),
)
GRID_STEP = 1.75


def _perp(d):
    return (-d[1], d[0])


def _neg(d):
    return (-d[0], -d[1])


def _node_kind(el):
    return component_kind(el)


def _transmission_of(el):
    try:
        return float(el.T)
    except Exception:
        return 1.0


def _child_candidates(kind, d_in, count, el):
    """Directions a component can send its outgoing beams along."""
    perp = _perp(d_in)
    if kind == "beamsplitter":
        if count == 1:
            return [d_in] if _transmission_of(el) > 0.5 else [perp]
        return [d_in, perp, _neg(perp), _neg(d_in)]
    if kind == "mirror":
        if count == 1:
            return [d_in]
        return [d_in, perp, _neg(perp), _neg(d_in)]
    if kind in ("lens", "modulator", "isolator", "laser"):
        return [d_in]
    return [d_in, perp, _neg(perp), _neg(d_in)]


def _manhattan(p, q):
    if p[0] == q[0] or p[1] == q[1]:
        return [p, q]
    return [p, (q[0], p[1]), q]


def _segment_blocked(start, end, occupied, ignore, radius=0.75):
    """True when a link would pass through an already placed component."""
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    length2 = dx * dx + dy * dy
    for name, (px, py) in occupied.items():
        if name in ignore:
            continue
        t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length2))
        cx, cy = x1 + t * dx, y1 + t * dy
        if math.hypot(px - cx, py - cy) < radius:
            return True
    return False


def _near_beam(point, owner, pos, neighbours, radius=0.62):
    """True when a candidate detector seat sits on an optical link of its owner."""
    px, py = point
    ox, oy = pos[owner]
    for neighbour in neighbours.get(owner, ()):
        if neighbour not in pos:
            continue
        nx, ny = pos[neighbour]
        dx, dy = nx - ox, ny - oy
        length2 = dx * dx + dy * dy
        if length2 == 0:
            continue
        t = max(0.0, min(1.0, ((px - ox) * dx + (py - oy) * dy) / length2))
        cx, cy = ox + t * dx, oy + t * dy
        if math.hypot(px - cx, py - cy) < radius:
            return True
    return False


def _free_cell(cell, occupied, minimum=1.05):
    for other in occupied.values():
        if abs(other[0] - cell[0]) < minimum and abs(other[1] - cell[1]) < minimum:
            return False
    return True


MIN_STEP = 1.75
MAX_STEP = 5.4


def _distance_units(length: float, max_length: float) -> float:
    """Log-compressed link length: 0 m links stay short, 25 km arms stay readable."""
    if length is None or length <= 0 or max_length <= 0:
        return MIN_STEP
    t = math.log10(1.0 + length) / math.log10(1.0 + max_length)
    return MIN_STEP + (MAX_STEP - MIN_STEP) * t


def _length_label(length: float | None) -> str | None:
    if length is None or length <= 0:
        return None
    if length >= 1000:
        return f"{length / 1000:.6g} km"
    if length >= 1:
        return f"{length:.6g} m"
    if length >= 1e-2:
        return f"{length * 100:.6g} cm"
    return f"{length * 1000:.6g} mm"


def _reach_count(start: str, blocked: str, neighbours: dict, component_nodes: set) -> int:
    """How many components are reachable through one side of a mirror."""
    seen = {blocked}
    queue = [start]
    count = 0
    while queue:
        current = queue.pop()
        for nxt in neighbours.get(current, ()):
            if nxt in seen:
                continue
            seen.add(nxt)
            queue.append(nxt)
            if nxt in component_nodes:
                count += 1
    return count


def compute_layout_2d(model):
    """Lay the optical bench out along real beam directions.

    A laser starts east; spaces continue straight; a 45-degree beamsplitter
    branches at 90 degrees (transmission straight, reflection perpendicular); a
    mirror that folds the beam turns it 90 degrees. Link lengths are drawn on a
    log scale and labelled with their physical length. Loop-closing connections
    are routed with Manhattan bends.
    """
    cn = model.to_component_network()
    neighbours = {name: set() for name in cn.nodes}
    for a, b in cn.edges:
        neighbours.setdefault(a, set()).add(b)
        neighbours.setdefault(b, set()).add(a)

    space_lengths = {}
    for a, b, data in cn.edges(data=True):
        ref = data.get("connection")
        space = ref() if callable(ref) else ref
        length = 0.0
        if space is not None:
            try:
                length = float(space.L)
            except Exception:
                length = 0.0
        space_lengths[(a, b)] = length
        space_lengths[(b, a)] = length
    max_length = max(space_lengths.values() or [1.0])

    kinds = {name: _node_kind(el) for name, el in model.elements.items()}
    leaves = collect_leaves(model)
    for _leaf, kind, _owner in leaves:
        kinds[_leaf] = kind

    roots = [n for n in cn.nodes if kinds.get(n) == "laser"]
    if not roots:
        roots = [n for n in cn.nodes if len(neighbours.get(n, ())) == 1]
    if not roots:
        roots = list(cn.nodes)[:1]
    root = sorted(roots)[0]

    pos = {root: (0.0, 0.0)}
    dir_in = {root: (1, 0)}
    occupied = {root: (0.0, 0.0)}
    order = [root]
    tree_edges = []
    closure = []

    for u in order:
        unplaced = [v for v in sorted(neighbours.get(u, ())) if v not in pos]
        already = [v for v in sorted(neighbours.get(u, ()))
                   if v in pos and v != _parent_of(u, tree_edges)]
        closure.extend((u, v) for v in already)
        if not unplaced:
            continue
        el = model.elements.get(u)
        kind = kinds.get(u, "default")
        d_in = dir_in.get(u, (1, 0))
        candidates = _child_candidates(kind, d_in, len(unplaced), el)
        for index, child in enumerate(unplaced):
            step = _distance_units(space_lengths.get((u, child), 0.0), max_length)
            chosen = None
            for offset in range(len(candidates)):
                direction = candidates[(index + offset) % len(candidates)]
                target = (pos[u][0] + direction[0] * step,
                          pos[u][1] + direction[1] * step)
                if _free_cell(target, occupied) and not _segment_blocked(pos[u], target, occupied, {u}):
                    chosen = (direction, target)
                    break
            if chosen is None:
                direction = candidates[index % len(candidates)]
                target = (pos[u][0] + direction[0] * MIN_STEP * 1.6,
                          pos[u][1] + direction[1] * MIN_STEP * 1.6)
                chosen = (direction, target)
            direction, target = chosen
            pos[child] = target
            dir_in[child] = direction
            occupied[child] = target
            tree_edges.append((u, child))
            order.append(child)

    # Any disconnected component still needs a seat, or its icon disappears.
    remaining = [name for name in cn.nodes if name not in pos]
    if remaining:
        x = max((p[0] for p in pos.values()), default=0.0) + MIN_STEP * 2
        for index, name in enumerate(sorted(remaining)):
            pos[name] = (x, -index * MIN_STEP)

    # Place detectors / Gauss markers beside their owning component.
    leaf_pos = {}
    for owner in [n for n in cn.nodes]:
        owner_leaves = [leaf for leaf, _kind, o in leaves if o == owner]
        if not owner_leaves:
            continue
        d_in = dir_in.get(owner, (1, 0))
        perp = _perp(d_in)
        ordered = [d_in, perp, _neg(perp), _neg(d_in)]
        ordered += [(dx, dy) for (dx, dy) in LEAF_DIRECTIONS
                    if (dx, dy) not in ordered]
        beam_count = len([v for v in neighbours.get(owner, ()) if v in pos])
        distances = (1.55, 1.95, 2.35, 2.8) if beam_count >= 3 else (1.3, 1.65, 2.05, 2.5)
        for index, leaf in enumerate(owner_leaves):
            target = None
            for distance in distances:
                for (dx, dy) in ordered:
                    candidate = (pos[owner][0] + dx * distance,
                                 pos[owner][1] + dy * distance)
                    if _free_cell(candidate, occupied, 1.0) and not _near_beam(candidate, owner, pos, neighbours):
                        target = candidate
                        break
                if target is not None:
                    break
            if target is None:
                target = (pos[owner][0] + 1.7, pos[owner][1] - 1.7)
            leaf_pos[leaf] = target
            occupied[leaf] = target

    pos.update(leaf_pos)
    routes = []
    for u, v in tree_edges:
        routes.append(([pos[u], pos[v]], "optical",
                       _length_label(space_lengths.get((u, v), 0.0))))
    seen = set()
    for u, v in closure:
        key = tuple(sorted((u, v)))
        if key in seen:
            continue
        seen.add(key)
        routes.append((_manhattan(pos[u], pos[v]), "optical",
                       _length_label(space_lengths.get((u, v), 0.0))))
    for leaf, _kind, owner in leaves:
        if leaf in pos:
            routes.append(([pos[owner], pos[leaf]], "leaf", None))

    leaf_owner = {leaf: owner for leaf, _kind, owner in leaves}
    children = {}
    for parent, child in tree_edges:
        children.setdefault(parent, []).append(child)
    component_nodes = set(cn.nodes)

    orient = {}
    mirror_faces = {}
    for name in pos:
        kind = kinds.get(name, "default")
        owner = leaf_owner.get(name)
        if owner is not None:
            dx = pos[name][0] - pos[owner][0]
            dy = pos[name][1] - pos[owner][1]
            norm = math.hypot(dx, dy) or 1.0
            travel = (dx / norm, dy / norm)
        else:
            travel = dir_in.get(name)
            if name == root or travel is None:
                outs = [dir_in[c] for c in children.get(name, [])]
                travel = outs[0] if outs else (1.0, 0.0)
        outs = [dir_in[c] for c in children.get(name, [])]
        for _u, v in closure:
            if _u == name:
                dx = pos[v][0] - pos[name][0]
                dy = pos[v][1] - pos[name][1]
                norm = math.hypot(dx, dy) or 1.0
                outs.append((dx / norm, dy / norm))
        if kind == "laser":
            direction = outs[0] if outs else travel
            orient[name] = int(round(math.degrees(math.atan2(direction[1], direction[0]))))
            continue
        if kind == "beamsplitter":
            perpendicular = [d for d in outs if abs(d[0] * travel[0] + d[1] * travel[1]) < 0.3]
            reflected = perpendicular[0] if perpendicular else (outs[0] if outs else None)
            if reflected is None:
                orient[name] = 0
                continue
            bx = reflected[0] - travel[0]
            by = reflected[1] - travel[1]
            orient[name] = 90 if bx * by < 0 else 0
            continue
        if kind == "mirror":
            # The HR coating faces the interferometer/cavity side: pick the
            # neighbour from which the most components are reachable.
            connections = [v for v in sorted(neighbours.get(name, ())) if v in pos]
            if not connections:
                orient[name] = 0
                continue
            target = connections[0]
            if len(connections) > 1:
                best = None
                for candidate in connections:
                    score = _reach_count(candidate, name, neighbours, component_nodes)
                    if best is None or score > best[1]:
                        best = (candidate, score)
                target = best[0]
            dx = pos[target][0] - pos[name][0]
            dy = pos[target][1] - pos[name][1]
            norm = math.hypot(dx, dy) or 1.0
            hr_dir = (dx / norm, dy / norm)
            mirror_faces[name] = (hr_dir, (-hr_dir[0], -hr_dir[1]))
            angle = math.degrees(math.atan2(hr_dir[1], hr_dir[0])) - 180.0
            orient[name] = int(round(angle / 90.0)) * 90
            continue
        if kind in ("lens", "modulator", "isolator", "telescope"):
            orient[name] = 90 if abs(travel[1]) > abs(travel[0]) else 0
            continue
        if kind in ("photodetector", "amplitude_detector", "ccd"):
            angle = math.degrees(math.atan2(-travel[1], -travel[0])) - 180
            orient[name] = int(round(angle / 90.0)) * 90
            continue
        if kind == "gauss":
            base = dir_in.get(owner or name, (1.0, 0.0))
            if owner == root:
                owner_outs = [dir_in[c] for c in children.get(owner, [])]
                base = owner_outs[0] if owner_outs else base
            orient[name] = int(round(math.degrees(math.atan2(base[1], base[0]))))
            continue
        orient[name] = 0

    return pos, kinds, routes, orient, mirror_faces


def _parent_of(node, tree_edges):
    for parent, child in tree_edges:
        if child == node:
            return parent
    return None


def _draw_placeholder(kind: str, x: float, y: float, ax, angle: float = 0):
    """Small vector stand-ins for component types without bundled artwork."""
    if kind == "gauss":
        w, h = 0.98, 0.52
        xs = np.linspace(-w * 0.34, w * 0.34, 80)
        curve = 0.17 * np.exp(-((xs / 0.17) ** 2))
        transform = Affine2D().rotate_deg_around(x, y, angle)
        upper = transform.transform(np.column_stack([x + xs, y + curve]))
        lower = transform.transform(np.column_stack([x + xs, y - curve]))
        ax.add_patch(FancyBboxPatch(
            (x - w / 2, y - h / 2), w, h,
            boxstyle="round,pad=0.02,rounding_size=0.12",
            linewidth=1.1, edgecolor="#7f8c8d", facecolor="#7f8c8d0f",
            linestyle=(0, (3, 2)), zorder=4,
            transform=transform + ax.transData,
        ))
        ax.plot(upper[:, 0], upper[:, 1], color="#2c6fb5", lw=1.2, zorder=5)
        ax.plot(lower[:, 0], lower[:, 1], color="#2c6fb5", lw=1.2, zorder=5)
        return w, h
    if kind == "ccd":
        w, h = 0.66, 0.54
        ax.add_patch(FancyBboxPatch(
            (x - w / 2, y - h / 2), w, h,
            boxstyle="round,pad=0.02,rounding_size=0.10",
            linewidth=1.2, edgecolor="#d35400", facecolor="#d3540014", zorder=4,
        ))
        ax.add_patch(plt.Circle((x + 0.04, y - 0.02), 0.13, color="#d35400", alpha=0.25, zorder=5))
        ax.add_patch(plt.Circle((x + 0.04, y - 0.02), 0.055, color="#d35400", zorder=6))
        ax.add_patch(plt.Rectangle((x - w / 2 + 0.07, y + h / 2 - 0.13), 0.12, 0.06,
                                   color="#d35400", zorder=6))
        return w, h
    w, h = 0.72, 0.54
    color = PALETTE.get(kind, PALETTE["default"])
    ax.add_patch(FancyBboxPatch(
        (x - w / 2, y - h / 2), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.10",
        linewidth=1.1, edgecolor=color, facecolor=color + "10",
        linestyle=(0, (2, 2)), zorder=4,
    ))
    ax.text(x, y, SHORT_LABEL.get(kind, kind)[:4], ha="center", va="center",
            fontsize=6.4, color=color, fontweight="bold", zorder=5)
    return w, h


def draw_icon_layout(model, pos, kinds, ax, graph=None, values=None, routes=None, orient=None, faces=None):
    """Draw the optical bench with the project's component artwork."""
    ax.set_facecolor("white")
    ax.set_axis_off()
    ax.set_autoscale_on(False)
    values = values or {}
    orient = orient or {}
    faces = faces or {}

    if routes is not None:
        centers = {(round(x, 4), round(y, 4)): name for name, (x, y) in pos.items()}
        for points, route_kind, length_label in routes:
            if len(points) < 2:
                continue
            pts = [tuple(point) for point in points]
            start_name = centers.get((round(pts[0][0], 4), round(pts[0][1], 4)))
            end_name = centers.get((round(pts[-1][0], 4), round(pts[-1][1], 4)))
            if start_name:
                pts[0] = _edge_point(pts[0][0], pts[0][1], pts[1][0], pts[1][1],
                                     _icon_box(start_name, kinds, orient))
            if end_name:
                pts[-1] = _edge_point(pts[-1][0], pts[-1][1], pts[-2][0], pts[-2][1],
                                      _icon_box(end_name, kinds, orient))
            xs = [point[0] for point in pts]
            ys = [point[1] for point in pts]
            if route_kind == "leaf":
                ax.plot(xs, ys, color="#b9c5d1", lw=1.1, linestyle=(0, (3, 3)),
                        zorder=1, solid_capstyle="round")
            else:
                ax.plot(xs, ys, color="#aebbc8", lw=1.6, zorder=1, solid_capstyle="round")
                ax.plot([xs[0], xs[-1]], [ys[0], ys[-1]], "o", ms=2.4,
                        color="#c0392b", alpha=0.5, zorder=5, linestyle="none")
            if length_label:
                segments = list(zip(pts, pts[1:]))
                if segments:
                    first, second = max(segments, key=lambda seg: math.hypot(
                        seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]))
                    mx = first[0] + (second[0] - first[0]) * 0.38
                    my = first[1] + (second[1] - first[1]) * 0.38
                    ax.text(mx, my, length_label, ha="center", va="center",
                            fontsize=6.2, color=MUTED, zorder=3,
                            bbox=dict(boxstyle="round,pad=0.14", facecolor="white",
                                      edgecolor="none", alpha=0.82))
    else:
        optical = set()
        for a, b in model.to_component_network().edges:
            optical.add((a, b))
            optical.add((b, a))
        edges = list(graph.edges) if graph is not None else list(model.to_component_network().edges)

        leaf_index: dict[str, int] = {}
        for a, b in edges:
            if a not in pos or b not in pos:
                continue
            (xa, ya), (xb, yb) = pos[a], pos[b]
            x1, y1 = _edge_point(xa, ya, xb, yb, _icon_box(a, kinds, orient))
            x2, y2 = _edge_point(xb, yb, xa, ya, _icon_box(b, kinds, orient))
            if (a, b) in optical:
                ax.plot([x1, x2], [y1, y2], color="#aebbc8", lw=1.6, zorder=1,
                        solid_capstyle="round")
                ax.plot([x1, x2], [y1, y2], "o", ms=2.6, color="#c0392b", alpha=0.55, zorder=2)
            else:
                index = leaf_index.get(a, 0)
                leaf_index[a] = index + 1
                curvature = 0.28 if index % 2 == 0 else -0.28
                ax.add_patch(FancyArrowPatch(
                    (x1, y1), (x2, y2), arrowstyle="-", lw=1.1,
                    color="#b9c5d1", linestyle=(0, (3, 3)), zorder=1,
                    connectionstyle=f"arc3,rad={curvature}", shrinkA=0, shrinkB=0,
                ))

    for name, (hr_dir, ar_dir) in faces.items():
        if name not in pos:
            continue
        x, y = pos[name]
        width, height = _icon_box(name, kinds, orient)
        for direction, colour in ((hr_dir, "#2c6fb5"), (ar_dir, "#1e8449")):
            half = (width if abs(direction[0]) > 0.5 else height) / 2.0
            cx = x + direction[0] * (half - 0.03)
            cy = y + direction[1] * (half - 0.03)
            tx, ty = -direction[1], direction[0]
            ax.plot([cx - tx * 0.17, cx + tx * 0.17],
                    [cy - ty * 0.17, cy + ty * 0.17],
                    color=colour, lw=3.2, solid_capstyle="round",
                    zorder=5, alpha=0.92)

    leaf_owner = {leaf: owner for leaf, _kind, owner in collect_leaves(model)}
    for name, (x, y) in pos.items():
        kind = kinds.get(name, "default")
        image = _icon_image(kind)
        angle = orient.get(name, 0)
        if image is not None:
            w, h = _icon_size(kind, image)
            if angle % 360:
                ax.imshow(image, extent=[x - w / 2, x + w / 2, y - h / 2, y + h / 2],
                          transform=Affine2D().rotate_deg_around(x, y, angle) + ax.transData,
                          zorder=4, interpolation="lanczos")
            else:
                ax.imshow(image, extent=[x - w / 2, x + w / 2, y - h / 2, y + h / 2],
                          zorder=4, interpolation="lanczos")
            w, h = _icon_box(name, kinds, orient)
        else:
            w, h = _draw_placeholder(kind, x, y, ax, angle)
        owner = leaf_owner.get(name)
        above = False
        if owner is not None and owner in pos:
            dy = y - pos[owner][1]
            dx = x - pos[owner][0]
            above = dy > 0.2 or (abs(dy) <= 0.45 and abs(dx) > 0.4)
        if above:
            ax.text(x, y + h / 2 + 0.10, name, ha="center", va="bottom",
                    fontsize=8.6, color=TEXT, fontweight="semibold", zorder=6)
            if name in values:
                entry = values[name]
                value, unit = entry if isinstance(entry, tuple) else (entry, "")
                ax.text(x, y + h / 2 + 0.34, _quantity(float(value), unit), ha="center",
                        va="bottom", fontsize=7.6, color=MUTED, zorder=6)
        else:
            ax.text(x, y - h / 2 - 0.12, name, ha="center", va="top",
                    fontsize=8.6, color=TEXT, fontweight="semibold", zorder=6)
            if name in values:
                entry = values[name]
                value, unit = entry if isinstance(entry, tuple) else (entry, "")
                ax.text(x, y - h / 2 - 0.36, _quantity(float(value), unit), ha="center",
                        va="top", fontsize=7.6, color=MUTED, zorder=6)

def fig_icon_layout(model, pos, kinds, path, title, graph=None, values=None, routes=None, orient=None, faces=None):
    xmin, xmax, ymin, ymax = _icon_bounds(pos)
    width, height = xmax - xmin, ymax - ymin
    fig_w = 9.6
    rect = (0.012, 0.03, 0.976, 0.895)
    fig_h = fig_w * rect[2] / rect[3] * height / width
    fig_h = min(max(fig_h, 2.2), 6.4)
    target = fig_h * rect[3] / (fig_w * rect[2])
    if height / width < target:
        new_h = target * width
        cy = (ymin + ymax) / 2
        ymin, ymax = cy - new_h / 2, cy + new_h / 2
    elif height / width > target:
        new_w = height / target
        cx = (xmin + xmax) / 2
        xmin, xmax = cx - new_w / 2, cx + new_w / 2

    fig = plt.figure(figsize=(fig_w, fig_h))
    ax = fig.add_axes(rect)
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin, ymax)
    draw_icon_layout(model, pos, kinds, ax, graph, values, routes, orient, faces)
    ax.text(0.0, 1.065, title, transform=ax.transAxes, ha="left", va="bottom",
            fontsize=12.5, fontweight="semibold", color=TEXT)
    ax.text(0.0, 1.012, "link lengths on a log scale  ·  HR = bright face, AR = green face",
            transform=ax.transAxes, ha="left", va="bottom",
            fontsize=7.4, color=MUTED)
    from matplotlib.lines import Line2D
    ax.legend(
        handles=[
            Line2D([0], [0], color="#2c6fb5", lw=4, label="HR coating"),
            Line2D([0], [0], color="#1e8449", lw=4, label="AR coating"),
        ],
        loc="upper right", frameon=True, framealpha=0.9, fontsize=7.0,
        handlelength=1.6, borderpad=0.45, labelspacing=0.35,
    )
    return _save(fig, path)


def _style():
    plt.rcParams.update({
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.facecolor": "white",
        "font.family": "DejaVu Sans",
        "text.color": TEXT,
        "axes.edgecolor": GRID,
        "axes.labelcolor": "#3d4b59",
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.titlesize": 12,
        "axes.titleweight": "semibold",
        "axes.labelsize": 9.5,
        "xtick.labelsize": 8.5,
        "ytick.labelsize": 8.5,
        "legend.fontsize": 8.5,
        "axes.grid": True,
        "grid.color": GRID,
        "grid.linewidth": 0.7,
        "axes.spines.top": False,
        "axes.spines.right": False,
    })


def _save(fig, path):
    fig.savefig(path, dpi=170, bbox_inches="tight", pad_inches=0.18)
    plt.close(fig)
    return path


# ------------------------------------------------------------- kat parsing ----
def _numeric_namespace(text: str) -> dict[str, float]:
    """Collect `name = <numeric expression>` assignments (Jupyter-cell style)."""
    ns: dict[str, float] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        m = re.match(r"^([A-Za-z_]\w*)\s*=\s*(.+)$", line)
        if not m:
            continue
        name, expr = m.group(1), m.group(2).strip()
        try:
            node = ast.parse(expr, mode="eval")
        except SyntaxError:
            continue
        allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name,
                   ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.USub, ast.UAdd,
                   ast.Mod, ast.FloorDiv, ast.Load)
        if not all(isinstance(n, allowed) for n in ast.walk(node)):
            continue
        try:
            ns[name] = float(eval(compile(node, "<vars>", "eval"), {"__builtins__": {}}, ns))
        except Exception:
            continue
    return ns


def _resolve_braces(text: str, ns: dict[str, float]) -> str:
    """Replace `{expr}` placeholders using the numeric namespace."""
    if "{" not in text:
        return text

    def repl(match):
        expr = match.group(1)
        try:
            node = ast.parse(expr, mode="eval")
            allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name,
                       ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.USub, ast.UAdd,
                       ast.Mod, ast.FloorDiv, ast.Load)
            if not all(isinstance(n, allowed) for n in ast.walk(node)):
                return match.group(0)
            val = eval(compile(node, "<expr>", "eval"), {"__builtins__": {}}, ns)
            if isinstance(val, (int, float)):
                return format(float(val), ".12g")
            return str(val)
        except Exception:
            return match.group(0)

    return re.sub(r"\{([^{}]+)\}", repl, text)


PY_PATTERNS = (r"import\s+finesse", r"from\s+finesse", r"finesse\.Model", r"model\.parse\(")


def extract_katscript(code: str) -> str:
    """Turn a pasted snippet (KatScript or a Finesse Python cell) into KatScript."""
    text = code.strip()
    # Python cell: pull the triple-quoted KatScript given to model.parse(...)
    if any(re.search(p, text) for p in PY_PATTERNS):
        blocks = re.findall(r'model\s*\.\s*parse\s*\(\s*([rRbBuU]{0,2})(\"\"\"|\'\'\'|\"|\')(.*?)\2', text, re.S)
        if blocks:
            body = "\n".join(b[2] for b in blocks)
            return _resolve_braces(body, _numeric_namespace(text))
        # Fall back to the lines that look like KatScript directives.
        lines = [ln for ln in text.splitlines()
                 if re.match(r"^\s*(l|laser|s|space|m|mirror|bs|beamsplitter|lens|mod|isol|pd|ad|ccd|cav|gauss|telescope|attr|noxaxis|xaxis|x2axis)\b", ln)]
        return _resolve_braces("\n".join(lines), _numeric_namespace(text))
    return _resolve_braces(text, _numeric_namespace(text))


KAT_COMPONENT_LINE = re.compile(
    r"^\s*(l|laser|s|space|m|mirror|bs|beamsplitter|lens|mod|modulator|isol|isolator|"
    r"pd|ad|ccd|cav|cavity|gauss|telescope)\s+[A-Za-z_]\w*",
    re.I,
)


def looks_like_katscript(text: str) -> bool:
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    comps = sum(1 for ln in lines if KAT_COMPONENT_LINE.match(ln))
    has_analysis = bool(re.search(r"\b(no|x|x2)axis\s*\(", text))
    return comps >= 2 or (comps >= 1 and has_analysis)


# ------------------------------------------------------------------ model ----
DETECTOR_DIRECTIVES = {"pd", "ad", "ccd"}


def normalize_kat(kat: str) -> str:
    """Detectors are attached to a node in Finesse 3, so drop legacy spaces to them."""
    detectors = set()
    for line in kat.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[0].lower() in DETECTOR_DIRECTIVES:
            detectors.add(parts[1])
    if not detectors:
        return kat
    kept = []
    for line in kat.splitlines():
        parts = line.strip().split()
        if parts and parts[0].lower() == "s":
            names = [p.split(".")[0] for p in parts[2:4]]
            if any(n in detectors for n in names):
                continue
        kept.append(line)
    return "\n".join(kept)


def build_model(kat: str):
    import finesse

    model = finesse.Model()
    model.parse(kat)
    return model


def component_kind(element) -> str:
    return TYPE_NAMES.get(type(element).__name__, "default")


def collect_leaves(model):
    """Detectors and Gauss sources are not part of the component network."""
    leaves = []  # (leaf_name, kind, owner_component)
    for det in getattr(model, "detectors", ()) or ():
        node = getattr(det, "node", None)
        owner = getattr(node, "component", None)
        if owner is not None:
            leaves.append((det.name, component_kind(det), owner.name))
    for name, el in model.elements.items():
        if type(el).__name__ == "Gauss":
            owner = getattr(el.node, "component", None)
            if owner is not None:
                leaves.append((name, "gauss", owner.name))
    return leaves


def compute_layout(model, dx: float = 2.9, dy: float = 1.9):
    """Layered left-to-right layout of the component graph."""
    import networkx as nx

    cn = model.to_component_network()
    graph = nx.Graph()
    for node in cn.nodes:
        graph.add_node(node)
    for a, b in cn.edges:
        graph.add_edge(a, b)

    leaves = collect_leaves(model)
    for leaf, kind, owner in leaves:
        if owner in graph:
            graph.add_node(leaf)
            graph.add_edge(owner, leaf)

    kinds = {name: component_kind(el) for name, el in model.elements.items()}
    for leaf, kind, _owner in leaves:
        kinds[leaf] = kind

    roots = [n for n in graph.nodes if kinds.get(n) == "laser"]
    roots += [n for n in graph.nodes if n not in roots]

    layers: dict[str, int] = {}
    order: list[str] = []
    for root in roots:
        if root in layers:
            continue
        queue = [root]
        layers[root] = 0
        while queue:
            cur = queue.pop(0)
            order.append(cur)
            for nbr in sorted(graph.neighbors(cur)):
                if nbr not in layers:
                    layers[nbr] = layers[cur] + (0.0 if kinds.get(nbr) in ("photodetector", "amplitude_detector", "ccd", "gauss") else 1)
                    queue.append(nbr)

    # Compact layers to consecutive integers, preserving BFS order.
    for name in layers:
        layers[name] = layers[name] if isinstance(layers[name], int) else int(round(layers[name]))
    used = sorted(set(layers.values()))
    remap = {v: i for i, v in enumerate(used)}
    layers = {k: remap[v] for k, v in layers.items()}

    by_layer: dict[int, list[str]] = {}
    for name, layer in layers.items():
        by_layer.setdefault(layer, []).append(name)

    pos: dict[str, tuple[float, float]] = {}
    previous_y: dict[str, float] = {}
    max_layer = max(by_layer) if by_layer else 0
    for layer in range(max_layer + 1):
        names = by_layer.get(layer, [])
        # Barycenter by the average y of already-placed neighbours.
        def key(name):
            ys = [previous_y[n] for n in graph.neighbors(name) if n in previous_y]
            return (sum(ys) / len(ys)) if ys else 0.0
        names.sort(key=lambda n: (key(n), n))
        count = len(names)
        for i, name in enumerate(names):
            y = (count - 1) / 2.0 - i
            pos[name] = (layer * dx, y * dy)
            previous_y[name] = pos[name][1]

    return pos, kinds, graph


def _edge_point(x, y, tx, ty, size):
    """Point where the line from (x,y) toward (tx,ty) leaves the box around (x,y)."""
    w, h = size
    dx, dy = tx - x, ty - y
    if dx == 0 and dy == 0:
        return x, y
    tx_ = (w / 2) / abs(dx) if dx else float("inf")
    ty_ = (h / 2) / abs(dy) if dy else float("inf")
    t = min(tx_, ty_, 1.0)
    return x + dx * t, y + dy * t


def _box_size(name: str) -> tuple[float, float]:
    return max(1.05, 0.17 * len(name) + 0.72), 0.64


def _bounds(pos):
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    return min(xs) - 1.1, max(xs) + 1.1, min(ys) - 0.9, max(ys) + 0.9


def draw_layout(model, pos, kinds, ax, graph=None):
    ax.set_facecolor("white")
    ax.set_axis_off()

    optical = set()
    for a, b in model.to_component_network().edges:
        optical.add((a, b))
        optical.add((b, a))
    edges = list(graph.edges) if graph is not None else list(model.to_component_network().edges)

    for a, b in edges:
        if a not in pos or b not in pos:
            continue
        (xa, ya), (xb, yb) = pos[a], pos[b]
        x1, y1 = _edge_point(xa, ya, xb, yb, _box_size(a))
        x2, y2 = _edge_point(xb, yb, xa, ya, _box_size(b))
        if (a, b) in optical:
            ax.plot([x1, x2], [y1, y2], color="#b8c4d0", lw=1.4, zorder=1, solid_capstyle="round")
        else:
            ax.plot([x1, x2], [y1, y2], color="#c8d1da", lw=1.1, zorder=1,
                    linestyle=(0, (3, 3)), solid_capstyle="round")
        if (a, b) not in optical:
            continue
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1.0
        ux, uy = dx / norm, dy / norm
        px, py = -uy, ux
        ax.add_patch(Polygon([
            (mx + ux * 0.13, my + uy * 0.13),
            (mx - ux * 0.07 + px * 0.10, my - uy * 0.07 + py * 0.10),
            (mx - ux * 0.07 - px * 0.10, my - uy * 0.07 - py * 0.10),
        ], closed=True, color="#9fb0c0", zorder=1.5))

    for name, (x, y) in pos.items():
        kind = kinds.get(name, "default")
        color = PALETTE.get(kind, PALETTE["default"])
        w, h = _box_size(name)
        if kind in ("photodetector", "amplitude_detector", "ccd"):
            w, h = w, 0.6
        if kind == "gauss":
            w, h = max(w, 1.15), 0.56
        box = FancyBboxPatch(
            (x - w / 2, y - h / 2), w, h,
            boxstyle="round,pad=0.02,rounding_size=0.14",
            linewidth=1.5, edgecolor=color, facecolor=color + "14", zorder=3,
        )
        if kind == "gauss":
            box.set_linestyle((0, (3, 2)))
        ax.add_patch(box)
        label = SHORT_LABEL.get(kind, "")
        ax.text(x, y + (0.11 if label else 0), name, ha="center", va="center",
                fontsize=9, color=TEXT, fontweight="semibold", zorder=4)
        if label:
            ax.text(x, y - 0.17, label, ha="center", va="center", fontsize=6.6,
                    color=color, fontweight="bold", zorder=4, alpha=0.9)

    xmin, xmax, ymin, ymax = _bounds(pos)
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin, ymax)


def _q_at(beam, node):
    try:
        data = beam[node]
    except Exception:
        return None
    return getattr(data, "qx", None) or getattr(data, "q", None)


def beam_segments(model, beam):
    """Space-by-space beam widths following the actual propagation direction."""
    net = model.optical_network
    gausses = [e for e in model.elements.values() if type(e).__name__ == "Gauss"]
    if not gausses:
        return []
    start = gausses[0].node.full_name
    if start not in net:
        return []

    space_len = {}
    for _a, _b, data in model.to_component_network().edges(data=True):
        ref = data.get("connection")
        space = ref() if callable(ref) else ref
        if space is None:
            continue
        try:
            length = float(space.L)
        except Exception:
            length = 0.0
        for nu, nv in ((space.portA.o, space.portB.i), (space.portB.o, space.portA.i)):
            space_len[(nu.full_name, nv.full_name)] = length

    def node_of(name):
        try:
            return net.nodes[name]["weakref"]()
        except Exception:
            return None

    segments = []
    visited = {start}
    z = {start: 0.0}
    queue = [start]
    while queue:
        u_name = queue.pop(0)
        u = node_of(u_name)
        wu = _q_at(beam, u) if u is not None else None
        for v_name in sorted(net.successors(u_name)):
            if v_name in visited:
                continue
            visited.add(v_name)
            v = node_of(v_name)
            wv = _q_at(beam, v) if v is not None else None
            same_component = u_name.split(".")[0] == v_name.split(".")[0]
            length = 0.0 if same_component else space_len.get((u_name, v_name), 0.0)
            segments.append((u_name, v_name, length,
                             float(wu.w) if wu is not None else None,
                             float(wv.w) if wv is not None else None))
            z[v_name] = z[u_name] + length
            queue.append(v_name)
    return segments


def fig_layout(model, pos, kinds, path, title, graph=None):
    xmin, xmax, ymin, ymax = _bounds(pos)
    width, height = xmax - xmin, ymax - ymin
    fig_w = 9.2
    rect = (0.012, 0.03, 0.976, 0.895)
    fig_h = fig_w * rect[2] / rect[3] * height / width
    fig_h = min(max(fig_h, 2.0), 5.3)
    target = fig_h * rect[3] / (fig_w * rect[2])
    if height / width < target:
        new_h = target * width
        cy = (ymin + ymax) / 2
        ymin, ymax = cy - new_h / 2, cy + new_h / 2
    elif height / width > target:
        new_w = height / target
        cx = (xmin + xmax) / 2
        xmin, xmax = cx - new_w / 2, cx + new_w / 2

    fig = plt.figure(figsize=(fig_w, fig_h))
    ax = fig.add_axes(rect)
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin, ymax)
    draw_layout(model, pos, kinds, ax, graph)
    ax.text(0.0, 1.065, title, transform=ax.transAxes, ha="left", va="bottom",
            fontsize=12.5, fontweight="semibold", color=TEXT)
    ax.text(0.0, 1.012, "link lengths on a log scale  ·  HR = bright face, AR = green face",
            transform=ax.transAxes, ha="left", va="bottom",
            fontsize=7.4, color=MUTED)
    from matplotlib.lines import Line2D
    ax.legend(
        handles=[
            Line2D([0], [0], color="#2c6fb5", lw=4, label="HR coating"),
            Line2D([0], [0], color="#1e8449", lw=4, label="AR coating"),
        ],
        loc="upper right", frameon=True, framealpha=0.9, fontsize=7.0,
        handlelength=1.6, borderpad=0.45, labelspacing=0.35,
    )
    return _save(fig, path)


def fig_beam(model, path, title):
    beam = model.beam_trace()
    segments = beam_segments(model, beam)
    if not segments:
        return None

    z = {}
    widths = {}
    comp_of = {}
    for u, v, length, wu, wv in segments:
        z.setdefault(u, 0.0)
        z[v] = z[u] + length
        if wu is not None:
            widths[u] = wu
        if wv is not None:
            widths[v] = wv
        comp_of[u] = u.split(".")[0]
        comp_of[v] = v.split(".")[0]

    kinds = {n: component_kind(e) for n, e in model.elements.items()}
    fig, ax = plt.subplots(figsize=(7.8, 3.9))
    fig.subplots_adjust(left=0.09, right=0.97, top=0.85, bottom=0.15)
    branches = {}
    palette = ["#2c6fb5", "#c0392b", "#1e8449", "#b9770e", "#7d3c98", "#117a65"]
    seen_pairs = set()

    for u, v, length, wu, wv in segments:
        if wu is None or wv is None:
            continue
        key = (z[u], z[v])
        color = branches.get(u)
        if color is None:
            color = palette[len(branches) % len(palette)]
            branches[u] = color
        branches.setdefault(v, color)
        ax.plot([z[u], z[v]], [wu * 1e3, wv * 1e3], color=color, lw=2.0,
                solid_capstyle="round", zorder=2)
        for node_name, node_z, node_w in ((u, z[u], wu), (v, z[v], wv)):
            kind = kinds.get(comp_of.get(node_name, ""), "default")
            ax.plot([node_z], [node_w * 1e3], "o", ms=4.2,
                    color=PALETTE.get(kind, PALETTE["default"]),
                    markeredgecolor="white", markeredgewidth=0.7, zorder=4)

    # Label each component once, at its outermost traced node; stagger collisions.
    best = {}
    for name, zz in z.items():
        comp = comp_of.get(name, name)
        if name not in widths:
            continue
        if comp not in best or zz > best[comp][0]:
            best[comp] = (zz, widths[name])
    labels = sorted(best.items(), key=lambda kv: kv[1][0])
    for i, (comp, (zz, ww)) in enumerate(labels):
        kind = kinds.get(comp, "default")
        offset = 11 if i % 2 == 0 else -15
        ax.annotate(comp, (zz, ww * 1e3), textcoords="offset points", xytext=(0, offset),
                    ha="center", fontsize=7.8, color=PALETTE.get(kind, TEXT), zorder=5)

    ax.set_xlabel("Optical path length from the source [m]")
    ax.set_ylabel("Beam radius w [mm]")
    ax.set_ylim(bottom=0)
    ax.margins(x=0.04)
    ax.grid(True, alpha=0.6)
    ax.set_title(title, loc="left", pad=10)
    return _save(fig, path)


# --------------------------------------------------------------- detector ----
def _detector_frames(model, sol):
    frames = []
    for det in getattr(model, "detectors", ()) or ():
        try:
            value = np.asarray(sol[det.name])
        except Exception:
            continue
        frames.append((det.name, value))
    return frames


def _format_value(v: float) -> str:
    if v == 0:
        return "0"
    if 1e-3 <= abs(v) < 1e5:
        return f"{v:.4g}"
    return f"{v:.3e}"


def fig_outputs(model, sol, path, title):
    deterministic = isinstance(sol.x, tuple) and len(sol.x) > 0
    frames = _detector_frames(model, sol)
    scalar = []
    curves = []
    for name, value in frames:
        if value.ndim == 0:
            scalar.append((name, float(value.real if np.iscomplexobj(value) else value)))
        elif value.ndim >= 2:
            continue  # CCD frames rendered separately
        else:
            curves.append((name, value))
    if not scalar and not curves:
        return None, {"detectors": []}

    units = {det.name: _detector_unit(det) for det in getattr(model, "detectors", ()) or ()}
    meta = {"detectors": [], "mode": "readout"}
    if curves and deterministic:
        meta["mode"] = "sweep"
        meta["sweep"] = _sweep_label(model)
        x = np.asarray(sol.x[0], dtype=float)
        fig, ax = plt.subplots(figsize=(7.4, 3.9))
        fig.subplots_adjust(left=0.09, right=0.97, top=0.86, bottom=0.14)
        colors = ["#2c6fb5", "#c0392b", "#1e8449", "#b9770e", "#7d3c98"]
        for i, (name, y) in enumerate(curves):
            y = np.asarray(y)
            if np.iscomplexobj(y):
                ax.plot(x, np.abs(y), color=colors[i % len(colors)], lw=1.8, label=name)
            else:
                ax.plot(x, y, color=colors[i % len(colors)], lw=1.8, label=name)
            meta["detectors"].append({
                "name": name,
                "min": float(np.nanmin(np.abs(y) if np.iscomplexobj(y) else y)),
                "max": float(np.nanmax(np.abs(y) if np.iscomplexobj(y) else y)),
            })
        ax.set_xlabel(_sweep_label(model))
        ax.set_ylabel("Signal")
        ax.set_title(title, loc="left", pad=10)
        ax.legend(loc="best", frameon=False)
        ax.grid(True, alpha=0.6)
        return _save(fig, path), meta

    count = len(scalar)
    fig_h = max(1.45, 0.5 * count + 1.05)
    fig, ax = plt.subplots(figsize=(6.4, fig_h))
    fig.subplots_adjust(left=0.04, right=0.96, top=0.80, bottom=0.06)
    ax.axis("off")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.text(0.0, 1.02, title, fontsize=11.5, fontweight="semibold", color=TEXT,
            transform=ax.transAxes, va="bottom")
    ax.text(0.0, 0.93, "Detector", fontsize=8.4, color=MUTED, va="center")
    ax.text(1.0, 0.93, "Output", fontsize=8.4, color=MUTED, va="center", ha="right")
    ax.plot([0, 1], [0.88, 0.88], color=GRID, lw=1.0)
    span = 0.80 / max(count, 1)
    for index, (name, value) in enumerate(scalar):
        y = 0.86 - span * (index + 0.5)
        ax.text(0.0, y, name, fontsize=10.5, color=TEXT, va="center")
        ax.text(1.0, y, _quantity(value, units.get(name, "")), fontsize=11, color=TEXT,
                va="center", ha="right", fontweight="semibold")
        if index < count - 1:
            ax.plot([0, 1], [y - span / 2, y - span / 2], color=GRID, lw=0.6)
    for name, value in scalar:
        meta["detectors"].append({"name": name, "value": value, "unit": units.get(name, "")})
    path_out = _save(fig, path)
    return path_out, meta


def _sweep_label(model):
    try:
        analysis = model.analysis
        params = getattr(analysis, "parameters", None)
        if params:
            names = []
            for p in params:
                names.append(str(getattr(p, "parameter", p)))
            return ", ".join(names)
    except Exception:
        pass
    return "Sweep parameter"


def fig_ccd(model, sol, path, title):
    frames = []
    for name, value in _detector_frames(model, sol):
        if value.ndim == 3:
            frames.append((name, np.abs(np.asarray(value[0]))))
        elif value.ndim == 2:
            frames.append((name, np.abs(value)))
    if not frames:
        return None
    fig, axes = plt.subplots(1, len(frames), figsize=(4.3 * len(frames), 3.9), squeeze=False)
    for ax, (name, data) in zip(axes[0], frames):
        im = ax.pcolormesh(data, cmap="inferno", shading="auto")
        ax.set_title(f"CCD {name}", loc="left", fontsize=10)
        ax.set_aspect("equal")
        ax.set_xlabel("x [px]")
        ax.set_ylabel("y [px]")
        ax.grid(False)
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03, label="Intensity")
    fig.suptitle(title, x=0.01, ha="left", fontsize=11, color=TEXT)
    fig.tight_layout()
    return _save(fig, path)


# ------------------------------------------------------------------- main ----
def render(code: str, outdir: str, title: str | None = None) -> dict:
    os.makedirs(outdir, exist_ok=True)
    result: dict[str, Any] = {
        "ok": False,
        "title": title or "Finesse visualization",
        "images": [],
        "detectors": [],
        "warnings": [],
        "error": None,
        "katscript": "",
        "components": [],
    }
    _style()

    kat = normalize_kat(extract_katscript(code))
    if not kat.strip():
        result["error"] = "No Finesse KatScript found in this snippet."
        return result
    result["katscript"] = kat

    try:
        model = build_model(kat)
    except Exception as exc:
        result["error"] = _concise_error(exc)
        return result

    result["ok"] = True
    elements = []
    for name, el in model.elements.items():
        elements.append({"name": name, "type": type(el).__name__})
    result["components"] = elements

    routes = None
    layout_graph = None
    orient = {}
    mirror_faces = {}
    try:
        pos, kinds, routes, orient, mirror_faces = compute_layout_2d(model)
    except Exception as exc:
        result["warnings"].append(f"2d layout: {_concise_error(exc)}")
        try:
            pos, kinds, layout_graph = compute_layout(model)
        except Exception as exc2:
            result["warnings"].append(f"layout: {_concise_error(exc2)}")
            pos, kinds = {}, {}

    stem = "finesse"
    fig_title = title or "Finesse model"

    sol = None
    det_values = {}
    try:
        has_analysis = model.analysis is not None
        sol = model.run(None if has_analysis else "noxaxis()")
        static = not (isinstance(getattr(sol, "x", None), tuple) and len(sol.x) > 0)
        if static:
            for det in getattr(model, "detectors", ()) or ():
                try:
                    value = np.asarray(sol[det.name])
                    if value.ndim == 0:
                        det_values[det.name] = (float(np.real(value)), _detector_unit(det))
                except Exception:
                    pass
    except Exception as exc:
        result["warnings"].append(f"simulation: {_concise_error(exc)}")

    if pos:
        try:
            path = os.path.join(outdir, f"{stem}-layout.png")
            if ASSET_DIR.is_dir():
                fig_icon_layout(model, pos, kinds, path, fig_title, layout_graph,
                                det_values, routes, orient, mirror_faces)
            else:
                fig_layout(model, pos, kinds, path, fig_title, layout_graph)
            result["images"].append({
                "file": os.path.basename(path),
                "title": "Optical layout",
                "caption": f"{len(elements)} elements, {len(list(model.to_component_network().edges))} connections",
            })
        except Exception as exc:
            result["warnings"].append(f"layout figure: {_concise_error(exc)}")

        if any(type(el).__name__ == "Gauss" for el in model.elements.values()):
            try:
                path = os.path.join(outdir, f"{stem}-beam.png")
                if fig_beam(model, path, fig_title):
                    result["images"].append({
                        "file": os.path.basename(path),
                        "title": "Gaussian beam",
                        "caption": "Beam radius along the optical path",
                    })
            except Exception as exc:
                result["warnings"].append(f"beam figure: {_concise_error(exc)}")

    if sol is not None:
        out_path = os.path.join(outdir, f"{stem}-outputs.png")
        try:
            path, meta = fig_outputs(model, sol, out_path, fig_title)
        except Exception as exc:
            path, meta = None, {"detectors": []}
            result["warnings"].append(f"detector figure: {_concise_error(exc)}")
        if path:
            result["images"].append({
                "file": os.path.basename(path),
                "title": "Sweep" if meta.get("mode") == "sweep" else "Detector readout",
                "caption": f"over {meta['sweep']}" if meta.get("sweep") else "",
            })
        result["detectors"] = meta.get("detectors", [])

        ccd_path = os.path.join(outdir, f"{stem}-ccd.png")
        try:
            path = fig_ccd(model, sol, ccd_path, fig_title)
        except Exception as exc:
            path = None
            result["warnings"].append(f"ccd figure: {_concise_error(exc)}")
        if path:
            result["images"].append({
                "file": os.path.basename(path),
                "title": "CCD intensity",
                "caption": "Field intensity at the camera",
            })

    return result


def _concise_error(exc: BaseException) -> str:
    text = str(exc).strip()
    if not text:
        text = type(exc).__name__
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return " | ".join(lines[:4])[:600]


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="file containing KatScript or a Finesse Python cell")
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--title", default=None)
    args = parser.parse_args(argv)
    with open(args.input, "r", encoding="utf-8") as fh:
        code = fh.read()
    try:
        result = render(code, args.outdir, args.title)
    except Exception as exc:  # pragma: no cover - defensive
        result = {"ok": False, "error": _concise_error(exc), "images": [],
                  "warnings": [], "detectors": [], "components": [], "title": args.title or ""}
        if os.environ.get("FINESSE_VIZ_DEBUG"):
            traceback.print_exc()
    with open(args.json_out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
