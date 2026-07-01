# perfEdit

A personal perfboard-planning editor. Design reusable **modules** (footprint + labeled pins/IO) into a library, drag them onto a board, wire them, label components and tracks, and flip between the component and track (solder) sides. Planning only — no import/export; boards auto-save locally in the browser.

## Run

```bash
npm install
npm run dev
```

Opens in your browser. Everything auto-saves to browser storage and reloads next time.

## Features

- Module designer + shared library (size in holes, per-pin type/name/label, body color, designator prefix)
- Drag modules onto a board, snap to grid, rotate (R), move, delete, auto-designators (U1, J1…)
- Wiring with nets, per-track color and label; board input/output ports; power/ground bus rails (red=VCC, black=GND)
- Flip board (F) — track side is a horizontal mirror; bodies ghost, pins stay solid, labels stay readable
- Coordinate rulers (A/B/C… + row numbers)
- Hover a hole to highlight everything electrically connected; live error checks (power/ground shorts, overlaps) in the Issues panel
- Undo/redo, zoom/pan (wheel = pan, ⌘/pinch = zoom)

## Stack

Vite + React + TypeScript, react-konva (canvas), Zustand. Geometry is stored in integer hole coordinates; flip and zoom/pan are render-time transforms.
