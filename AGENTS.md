# perfEdit — guide for automated agents

How to author and edit perfboard designs in this app **programmatically**, without
click-by-click UI driving. Read this before editing a board. Human-facing feature docs
are in `README.md`; this file is the machine contract.

The reliable workflow is: **generate a design JSON with a Node script → self-check it →
drop it in `public/designs/` → load it in the app by URL.** Boards are plain data
(integer hole coordinates), so a script is the fastest, most verifiable way to build one.

---

## 1. The data model (`src/domain/types.ts`)

A `Workspace` = `{ schemaVersion, library: ModuleDefinition[], boards: Board[], settings }`.
Geometry is stored in **integer hole coordinates** `(col, row)`, origin top-left. Pitch
(2.54 mm) is a render constant, never stored. "Flip to track side" and zoom/pan are
render-time transforms — they never change stored coordinates.

### ModuleDefinition (a reusable part in the library)
```ts
{
  id, name, designatorPrefix,          // e.g. 'U', 'J', 'C', 'D', 'R'
  cols, rows,                          // PIN-GRID bounding box, in holes (>=1)
  color,                               // body fill, hex
  pins: Pin[],                         // Pin = { id, col, row, type, name, label? }
  bodyMm?: { w, h, dx, dy },           // PHYSICAL outline in mm (see §2) — optional
  mayOverhang?: boolean,               // true = suppress the board-edge overhang warning
  notes?: string,                      // datasheet caveats / purchase info (shown in Properties)
}
```
- `pin.col/row` are **relative to the module origin, unrotated**, and must lie inside
  `[0,cols) × [0,rows)`.
- `pin.type` ∈ `input | output | power | ground | passive | bidirectional | no-connect`.
  Colors: power=red, ground=black, output=amber, input=green, bidirectional=violet,
  passive=grey. The analyzer flags a **power+ground short** on one net and warns on
  **multiple outputs** on one net, so type your pins correctly.

### PlacedModule (an instance on a board)
```ts
{ id, defId, col, row, rotation, side:'top', designator, labelOverride? }
```
- `rotation` ∈ `0 | 90 | 180 | 270`. Modules live on `side:'top'`.
- `designator` must be unique per board (`U1`, `J2`, …).

### Board
```ts
{ id, name, type:'perfboard'|'pad-per-hole', cols, rows, activeSide:'top',
  modules, tracks, io, annotations, nets, createdAt, updatedAt }
```
- `Track = { id, side:'top'|'bottom', points: Hole[] (>=2), netId?, color?, rail?, label? }`
- `Net = { id, name, color, kind:'signal'|'power'|'ground' }`
- `BoardIO = { id, kind:'input'|'output', name, col, row, netId?, color? }`
- `Annotation = { id, text, col, row, side:'top'|'bottom'|'both', color? }`

---

## 2. Physical body size (`bodyMm`) — the key modeling rule

Most real modules are **larger than the holes their pins land on** (e.g. a Pololu buck is
40.6×20.3 mm but only exposes a handful of pads). Model that with `bodyMm`:

- `w, h` = body size in **mm**. `dx, dy` = the body's **top-left corner** relative to the
  **center of pin-grid hole (0,0)**, in mm. `dx`/`dy` are usually **negative** (the body
  extends up/left past pin 0,0).
- Converted to holes with pitch 2.54 mm and **rotated with the module**, so the body always
  tracks its pins. Occupancy/overlap checks and the render both use it.
- **Centered on the pin grid:** `dx = -((w - (cols-1)*2.54)/2)`, `dy = -((h - (rows-1)*2.54)/2)`.
- **Offset (pins along one edge):** give `dy` a large negative value so the body extends away
  from the pin row (see the 6 V buck in the Pip design — a 6-pin row with a 25 mm body above it).
- Omit `bodyMm` and the body just hugs the pin grid (legacy behavior).
- Set `mayOverhang:true` for edge connectors whose shroud is *meant* to hang off the board
  (XT30, card edges) — otherwise the analyzer warns when any body crosses the board edge.
  Leaving it **false on an oversized part is how you surface a "doesn't fit" finding** — the
  overhang warning is a feature, not a nuisance.

The Module Designer UI exposes all of this ("Physical body size (mm)" section); scripts set
it directly.

---

## 3. Rotation (must match the app exactly)

Pins and bodies rotate with this mapping (`src/domain/geometry.ts`), where `W=cols`, `H=rows`:
```
 90:  (col,row) -> (H-1-row, col)
180:  (col,row) -> (W-1-col, H-1-row)
270:  (col,row) -> (row, W-1-col)
```
World pin = `placed.origin + rotateOffset(pin, rotation, def.cols, def.rows)`. If you compute
pin holes yourself (e.g. for wiring), use exactly this or your tracks won't land on the pins.

---

## 4. Wiring without accidental shorts

Connectivity is **union-find over holes**: a track unions its **listed points only**
(consecutive `points[i-1]`↔`points[i]`), *not* the holes a straight segment visually crosses.
Two elements on the **same hole** are the same electrical node (that's how a wire endpoint
connects to a pin).

**Therefore the safe scripted-wiring idiom is a 2-point track from source hole to dest hole.**
It connects exactly those two holes — a line that crosses other tracks on screen does **not**
union with them. To wire a net across N pins, chain 2-point tracks (`p0→p1, p1→p2, …`) or star
them from one hub hole. Avoid multi-point L-routes unless you've checked the corner hole is
free, since the corner *does* get unioned.

Give power/ground tracks `rail:true` (thicker) and a `netId` whose `kind` is `power`/`ground`
so the short-detector can see roles from tracks as well as pins.

### Orthogonal (H/V) routing
Wires are **horizontal/vertical only** — no diagonals. You may still emit 2-point diagonal
tracks in a design file (safest for connectivity, per above); the app **renders them
orthogonally** by inserting a display-only corner (`orthogonalize()` in `geometry.ts`), and
interactive drawing commits orthogonal points. So a diagonal 2-point track is fine in stored
data and shows as an L. If you want the *stored* geometry orthogonal, run the points through
`orthogonalize()` yourself — but note each inserted corner becomes a real unioned hole, so keep
corners off other nets.

### Wires follow modules (KiCad-style)
`moveModule(id, col, row)` shifts any track **endpoint that sits on one of the module's pins**
by the same delta and re-routes that track as a clean orthogonal elbow (`orthoElbow()`). So
moving a part drags its connections along and keeps them 90°. In the UI the wires follow
**live during the drag** (a transient `drag` store field offsets connected endpoints in the
render; the store commit happens once on drop, so undo stays a single step), and modules can be
dragged from **either board side** (the track-side view is mirrored, so the drag delta is
inverted when `activeSide==='bottom'`). Also on any programmatic `moveModule`. (It re-routes to
a single elbow between the two endpoints, so multi-corner hand-routing on an affected track is
replaced — wires here are simple.)

### No wires on top of each other (overlap DRC + auto-fix)
Wires may **cross** (perpendicular, or touch at a single junction hole) but must not **run on
top of each other** — two tracks on the **same `side`** that share a colinear segment
(same row/col, overlapping by more than one hole) are flagged in the Issues panel.
`wireOverlaps(board)` in `connectivity.ts` returns the offending segment pairs (id + segment
index); `analyze()` turns them into issues. Keep it clean by putting parallel-running nets on
**opposite board sides** (real perfboards are 2-sided; only same-side runs are flagged) or on
different rows/cols. The Pip generator does this automatically — `consolidateWires()` collapses
each net to one nearest-neighbour path, `assignSides()` 2-colours nets onto the two faces, and
an auto-fix pass shifts any residual apart.
- **`autoFixOverlaps()`** (store; toolbar **"Fix overlaps"** button) shifts one segment of each
  overlapping pair perpendicular (±1,±2,…) until the overlap clears, guarding against creating a
  power/ground short. Best-effort: returns `{fixed, remaining}` (a dense board may leave a few).
- **Click-to-highlight:** every `Issue` carries `refs: string[]` — the ids of the modules/tracks
  it involves (both overlapping tracks, the two overlapping bodies, the shorted net's members,
  etc.). Clicking an issue in the Issues panel flips to the offending wires' side if needed,
  centers on them, and **selects them** (highlighted thick blue) so you can drag/fix them.

### Dragging a wire (segment drag, KiCad-style)
Grab a wire **anywhere along its length** (`draggable` Line, `select` tool) and drag
perpendicular to move that segment. `dragSegment(points, i, d)` in `geometry.ts` moves the
segment: interior joints move; a **fixed terminal** (the wire's first/last point, on a pin)
stays put and a **new joint is inserted** so the wire stays connected (a 2-pin wire becomes a
staple). `nearestSegmentIndex(points, hole)` picks which segment you grabbed; `segmentsOf()`
lists a track's H/V segments. In the UI this previews live via a transient `wireDrag` store
field and commits once on drop through `commitWireDrag(id, seg, dx, dy)`.

### Wire layering (solder order)
`wireLayers(board, side)` in `connectivity.ts` returns the wires grouped into solder passes for
one board side, **guaranteeing no layer contains two wires that cross**. A wire "crosses over"
another when it **passes through** (interior to a segment) a hole occupied by the other wire's
copper or endpoint/pin — the crossed wire must be soldered first (it's underneath). A wire only
ever crossed-over (never on top of anything) is still Layer 1.

Algorithm: build the crossing graph plus forced "must-be-under" edges (only when exactly one wire
passes over the other; a clean mutual perpendicular crossing has no forced order). Process wires
in topological order of the forced edges, then **greedily colour**: each wire takes the lowest
layer that is (a) above all its already-placed forced-under wires and (b) not shared by ANY
already-placed wire it crosses. This is a proper colouring, so crossing wires can never land on
the same layer — even when forced dependencies form a cycle (which broke the earlier longest-path
version). Layering is **per side**. The toolbar **"Layers"** toggle + ◀/▶ stepper
(`layerView`/`layerIndex`) walks the passes: current layer solid, earlier (soldered) layers dim,
later layers faintest, other side hidden.

### Track-side hit priority (wires over modules)
On the track side (`activeSide==='bottom'`) a module's body is **non-listening** (`fillEnabled`
off, pins non-listening) so only its **border** grabs the module — clicks/drags inside its
bounds fall through to the wires beneath it. This lets you edit wires that run under a module on
the solder side while still moving modules by their border. On the component side the whole body
grabs the module as usual.

---

## 5. Loading a design into the app

Put a design file at `public/designs/<name>.json`. Shape is a workspace subset:
`{ schemaVersion?, library?: ModuleDefinition[], boards?: Board[] }`. List it in
`public/designs/index.json` as `[{ file, name, description? }]` so it shows in the **Designs…**
toolbar dropdown.

**Auto-load on startup:** every design listed in `index.json` is imported automatically on app
launch, so all boards appear in the toolbar's board dropdown without the user opening a file.
It's **import-once** — a file is only auto-imported the first time it's seen (tracked in
`workspace.loadedDesigns`), so deleting one of its boards sticks and it isn't resurrected next
launch. Add a new file to `index.json` and it shows up on the next load.

**URL params** (`src/state/persistence.ts`, `src/main.tsx`):
- `?design=<name>` — also select that design's first board (it's auto-loaded regardless).
- `?fresh=1` — start from an empty default workspace (clears local storage first), then the
  auto-loader re-imports the full design set. `/?fresh=1&design=pip-power` = deterministic view.

**Import is merge-by-id** (`src/state/io.ts`): entries whose `id` already exists are replaced,
new ids appended. So **use stable, deterministic ids** in generated files — re-running your
generator and re-importing updates in place instead of duplicating. (This is why the Pip
generator uses ids like `mod_pip_boardA_U1`, not random uuids.)

Import is **validated** before it touches the workspace; on failure nothing changes and you
get a list of precise errors (bad pin coords, unknown `defId`, dangling `netId`, …). Malformed
files are rejected, not half-applied.

---

## 6. Programmatic hook (`window.perfEdit`)

Available in the running app (console or a driving agent). Defined in `src/main.tsx`:
```js
window.perfEdit.getWorkspace()          // full workspace object
window.perfEdit.exportJson()            // workspace as a JSON string
window.perfEdit.importData(obj)         // merge-by-id; returns { ok, errors, libraryIds, boardIds }
window.perfEdit.listBoards()            // [{ id, name, cols, rows }]
window.perfEdit.selectBoard(id)
window.perfEdit.selectBoardByName(sub)  // first board whose name includes sub; returns id|null
window.perfEdit.moveModule(id,col,row)  // move a module; connected wires follow + re-route orthogonally
window.perfEdit.issues(boardId?)        // design-rule issues for a board (defaults to current)
window.perfEdit.setCamera({scale,panX,panY})
window.perfEdit.fitBoard(pxW?, pxH?)    // frame the current board in the canvas
```
`issues()` runs the same `analyze()` the Issues panel uses — call it after an import to confirm
a design is clean (`[]`), or to read back the intended warnings.

---

## 7. Build a design from scratch (recommended recipe)

1. Write a Node ESM generator in `scripts/` (see `scripts/build-pip-power.mjs` as the worked
   example). Define module defs, place instances with explicit `(col,row,rotation)`, wire by
   **pin name** (resolve names → world holes with the §3 rotation), emit
   `public/designs/<name>.json` + update `index.json`.
2. **Self-check before writing.** The example script mirrors the app's geometry + connectivity
   and refuses to emit on: two pins on one hole, physical-body overlap (via `bodyMm`), body
   past a board edge (unless `mayOverhang`), or a power/ground short. Iterate against its
   report — let the checker place things, don't eyeball coordinates.
3. `node scripts/build-pip-power.mjs` → clean (0 errors; intended warnings are fine).
4. `node scripts/render-svg.mjs` → `public/designs/<boardId>.svg` per board — a standalone
   picture to eyeball (or convert: `qlmanage -t -s 1200 -o /tmp file.svg`). `render-ascii.mjs`
   prints a one-char-per-hole map for a fast text check.
5. Load in-app: `npm run dev`, open `/?fresh=1&design=<name>`, and/or
   `window.perfEdit.issues()` to confirm `[]`.

### Tuning placement when the checker reports overlaps
Bodies are bigger than pins — budget real footprints: a hole ≈ 2.54 mm, so a 40 mm part ≈ 16
holes. Space parts by **body extent**, not pin count. Right-angle connectors (XT30) need ~5-hole
centers so their shrouds clear. When two large parts fight for space, separate them on different
axes (see how the Pip Board B PCM strip and the tall boost are stacked, not side-by-side).

---

## 8. Invariants / gotchas

- Coordinates are integers; keep pins inside the pin grid and modules on `side:'top'`.
- `defId` on every placed module must resolve to a library entry present in the payload **or**
  already loaded. Nets referenced by tracks must exist on that board.
- Designators unique per board. Ids stable and globally unique (prefix by board to avoid
  collisions across boards in one file).
- The overhang/overlap analyzer uses `bodyMm` when present — a part with no `bodyMm` only
  reserves its pin grid and will *look* like it fits when the real part wouldn't. Add `bodyMm`
  to anything whose true size matters.
- Don't hand-write huge designs; generate + self-check. Verify with `issues()` returning `[]`,
  not by trusting the render.
