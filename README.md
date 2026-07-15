# perfEdit

A personal perfboard-planning editor. Design reusable **modules** (footprint + labeled pins/IO) into a library, drag them onto a board, wire them, label components and tracks, and flip between the component and track (solder) sides. Boards auto-save locally in the browser, and designs can be imported/exported as JSON.

> **Editing boards with an automated agent?** See [`AGENTS.md`](AGENTS.md) for the data model, the physical-body (mm) rule, safe scripted wiring, the `public/designs` loader, URL params, and the `window.perfEdit` hook.

## Run

```bash
npm install
npm run dev
```

Opens in your browser. Everything auto-saves to browser storage and reloads next time.

## Features

- Module designer + shared library (pin grid in holes, **physical body size in mm**, per-pin type/name/label, body color, designator prefix, notes)
- **Real footprints:** a module's body can be larger than its pin grid (most modules are) — set `w×h` mm plus an offset; the body rotates with the part, drives overlap/fit checks, and renders true-to-size
- Drag modules onto a board, snap to grid, rotate (R), move, delete, auto-designators (U1, J1…)
- Wiring with nets, per-track color and label; board input/output ports; power/ground bus rails (red=VCC, black=GND)
- **Orthogonal wires** — tracks route horizontal/vertical with 90° corners (no diagonals); **wires follow their modules live** as you drag a part (from either board side) and re-route automatically (KiCad-style)
- **Drag a wire** anywhere along its length to move that segment; fixed pin terminals stay put and new joints are inserted automatically. On the track side, dragging inside a module grabs the **wire** beneath it — modules move only by their border
- **Fix overlaps** button auto-resolves "wires on top of each other" by shifting them apart (guards against creating shorts)
- **Wire layering view** — step through the solder order one pass at a time: Layer 1 = wires that cross over nothing, each later layer stacks on top (per board side)
- Flip board (F) — track side is a horizontal mirror; bodies ghost, pins stay solid, labels stay readable
- Coordinate rulers (A/B/C… + row numbers)
- Hover a hole to highlight everything electrically connected; live error checks (power/ground shorts, pin/body overlaps, **body past board edge**, **wires running on top of each other**) in the Issues panel — **click an issue to highlight the exact wires/modules involved**
- **Import / Export** whole workspaces as JSON (merge-by-id); **any designs present in `public/designs` auto-load on startup** so every board is in the toolbar menu (also loadable via the toolbar or `?design=<name>`); `?fresh=1` for a clean deterministic start
- Undo/redo, zoom/pan (wheel = pan, ⌘/pinch = zoom)

## Designs (`public/designs/`)

Board designs are **private and not part of this repo** — `public/designs/` is gitignored, so a
fresh clone ships the editor with no boards and starts on an empty workspace.

To use your own designs, create the folder and drop them in:

```
public/designs/
  index.json          # [{ file, name, description? }] — the registry the app reads
  <name>.json         # a design: { schemaVersion?, library?, boards? }
```

Everything listed in `index.json` auto-loads on startup, so each board appears in the toolbar's
board dropdown (also selectable via `?design=<name>`; `?fresh=1` for a clean deterministic start).
See [`AGENTS.md`](AGENTS.md) §5 for the file shape and §7 for generating a design programmatically.

```bash
node scripts/render-svg.mjs <path/to/design.json>   # -> public/designs/<board>.svg (standalone pictures)
node scripts/render-ascii.mjs                        # one-char-per-hole text maps for a quick check
```

## Stack

Vite + React + TypeScript, react-konva (canvas), Zustand. Geometry is stored in integer hole coordinates; the physical body is stored in mm; flip and zoom/pan are render-time transforms.
