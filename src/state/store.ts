import { create } from 'zustand';
import {
  Workspace, Board, ModuleDefinition, Hole, Side, PlacedModule, Track, NetKind,
} from '../domain/types';
import { loadWorkspace, saveWorkspace, scheduleSave, makeDefaultWorkspace } from './persistence';
import { validatePayload, mergePayload, ImportPayload, ImportResult } from './io';
import { worldPins, holeKey, orthoElbow, orthogonalize, dragSegment } from '../domain/geometry';
import { analyze, wireOverlaps } from '../domain/connectivity';
import { uid, nextDesignator, expandLine } from '../util';

export type Tool = 'select' | 'wire' | 'rail-power' | 'rail-ground' | 'io-in' | 'io-out' | 'text';

interface Snap { library: ModuleDefinition[]; boards: Board[] }
const snap = (ws: Workspace): Snap => ({
  library: structuredClone(ws.library),
  boards: structuredClone(ws.boards),
});

interface StoreState {
  workspace: Workspace;
  currentBoardId: string | null;
  view: 'board' | 'designer';
  editingDef: ModuleDefinition | null;
  tool: Tool;
  selection: string[];
  hoverHole: Hole | null;
  wireDraft: { points: Hole[]; side: Side } | null;
  railStart: Hole | null;
  // Transient live-drag delta (data holes) while a module is being dragged.
  // Not persisted / not undoable; the render offsets connected wires by it.
  drag: { id: string; dx: number; dy: number } | null;
  // Transient live-drag of a single wire SEGMENT (perpendicular delta).
  wireDrag: { id: string; seg: number; dx: number; dy: number } | null;
  // Wire layering view: show solder-order layers one at a time (active side).
  layerView: boolean;
  layerIndex: number;
  scale: number;
  panX: number;
  panY: number;
  past: Snap[];
  future: Snap[];

  currentBoard: () => Board | undefined;

  setTool: (t: Tool) => void;
  setSelection: (ids: string[]) => void;
  toggleSelect: (id: string, additive: boolean) => void;
  setView: (v: 'board' | 'designer') => void;
  setCamera: (c: { scale?: number; panX?: number; panY?: number }) => void;
  setHoverHole: (h: Hole | null) => void;
  setDrag: (d: { id: string; dx: number; dy: number } | null) => void;
  setWireDrag: (d: { id: string; seg: number; dx: number; dy: number } | null) => void;
  setLayerView: (v: boolean) => void;
  setLayerIndex: (i: number) => void;
  /** Commit a wire-segment drag: move segment `seg` of track `id` by (dx,dy). */
  commitWireDrag: (id: string, seg: number, dx: number, dy: number) => void;
  /** Best-effort: shift overlapping wires apart until the overlap DRC is clean. */
  autoFixOverlaps: () => { fixed: number; remaining: number };

  undo: () => void;
  redo: () => void;

  /** Merge a design payload ({library?, boards?}) into the workspace by id. Undoable.
   *  Pass sourceFile to record it in workspace.loadedDesigns (startup auto-load). */
  importData: (data: unknown, sourceFile?: string) => ImportResult;

  addBoard: () => void;
  selectBoard: (id: string) => void;
  updateBoardMeta: (patch: Partial<Board>) => void;
  deleteBoard: (id: string) => void;
  flipBoard: () => void;

  startNewModule: () => void;
  editModule: (id: string) => void;
  setEditingDef: (d: ModuleDefinition) => void;
  saveEditingDef: () => void;
  cancelEditing: () => void;
  deleteModuleDef: (id: string) => void;

  placeModule: (defId: string, col: number, row: number) => void;
  moveModule: (id: string, col: number, row: number) => void;
  rotateModule: (id: string, dir?: 1 | -1) => void;
  patchModule: (id: string, patch: Partial<PlacedModule>) => void;

  startWire: (h: Hole, side: Side) => void;
  addWirePoint: (h: Hole) => void;
  finishWire: () => void;
  cancelWire: () => void;
  railClick: (h: Hole, kind: 'power' | 'ground') => void;
  addIO: (h: Hole, kind: 'input' | 'output') => void;
  addAnnotation: (h: Hole, text: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  addNet: (name: string, color: string, kind: NetKind) => string;
  deleteSelected: () => void;
  deleteEntity: (id: string) => void;
}

const init = loadWorkspace() ?? makeDefaultWorkspace();

export const useStore = create<StoreState>()((set, get) => {
  const commit = (fn: (ws: Workspace) => void) =>
    set((s) => {
      const past = [...s.past, snap(s.workspace)].slice(-50);
      const ws = structuredClone(s.workspace);
      fn(ws);
      scheduleSave(ws);
      return { workspace: ws, past, future: [] as Snap[] };
    });

  const withBoard = (fn: (b: Board, ws: Workspace) => void) =>
    commit((ws) => {
      const b = ws.boards.find((b) => b.id === get().currentBoardId);
      if (!b) return;
      b.updatedAt = Date.now();
      fn(b, ws);
    });

  const board = () => get().workspace.boards.find((b) => b.id === get().currentBoardId);

  return {
    workspace: init,
    currentBoardId: init.boards[0]?.id ?? null,
    view: 'board',
    editingDef: null,
    tool: 'select',
    selection: [],
    hoverHole: null,
    wireDraft: null,
    railStart: null,
    drag: null,
    wireDrag: null,
    layerView: false,
    layerIndex: 0,
    scale: 24,
    panX: 70,
    panY: 70,
    past: [],
    future: [],

    currentBoard: () => board(),

    setTool: (t) => set({ tool: t, selection: [], wireDraft: null, railStart: null }),
    setSelection: (ids) => set({ selection: ids }),
    toggleSelect: (id, additive) =>
      set((s) =>
        additive
          ? { selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] }
          : { selection: [id] }
      ),
    setView: (v) => set({ view: v }),
    setCamera: (c) => set((s) => ({ scale: c.scale ?? s.scale, panX: c.panX ?? s.panX, panY: c.panY ?? s.panY })),
    setHoverHole: (h) => set({ hoverHole: h }),
    setDrag: (d) => set({ drag: d }),
    setWireDrag: (d) => set({ wireDrag: d }),
    setLayerView: (v) => set({ layerView: v, layerIndex: 0, selection: [] }),
    setLayerIndex: (i) => set({ layerIndex: Math.max(0, i) }),
    commitWireDrag: (id, seg, dx, dy) =>
      withBoard((b) => {
        if (dx === 0 && dy === 0) return;
        const t = b.tracks.find((x) => x.id === id);
        if (!t) return;
        const np = dragSegment(t.points, seg, { col: dx, row: dy });
        if (np.length >= 2) t.points = np;
      }),
    autoFixOverlaps: () => {
      let result = { fixed: 0, remaining: 0 };
      withBoard((b, ws) => {
        const pitch = ws.settings.pitchMm || 2.54;
        const errCount = () => analyze(b, ws.library, pitch).issues.filter((i) => i.severity === 'error').length;
        const baseErr = errCount();
        const pairKey = (o: { aId: string; bId: string }) => [o.aId, o.bId].sort().join('|');
        const start = wireOverlaps(b).length;
        const stuck = new Set<string>();
        for (let iter = 0; iter < 400; iter++) {
          const ovs = wireOverlaps(b).filter((o) => !stuck.has(pairKey(o)));
          if (!ovs.length) break;
          const o = ovs[0];
          // Shift the *second* track's overlapping segment perpendicular, trying
          // increasing offsets both ways; keep the first that reduces the total
          // overlap count without introducing an error (short / pin clash).
          const t = b.tracks.find((x) => x.id === o.bId)!;
          const before = wireOverlaps(b).length;
          let fixed = false;
          for (const mag of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
            const d = o.orient === 'h' ? { col: 0, row: mag } : { col: mag, row: 0 };
            const cand = dragSegment(t.points, o.bSeg, d);
            if (cand.length < 2) continue;
            const saved = t.points;
            t.points = cand;
            if (wireOverlaps(b).length < before && errCount() <= baseErr) { fixed = true; break; }
            t.points = saved;
          }
          if (!fixed) stuck.add(pairKey(o));
        }
        result = { fixed: start - wireOverlaps(b).length, remaining: wireOverlaps(b).length };
      });
      return result;
    },

    undo: () =>
      set((s) => {
        if (!s.past.length) return {};
        const prev = s.past[s.past.length - 1];
        const future = [...s.future, snap(s.workspace)];
        const ws = structuredClone(s.workspace);
        ws.library = prev.library;
        ws.boards = prev.boards;
        scheduleSave(ws);
        return { workspace: ws, past: s.past.slice(0, -1), future };
      }),
    redo: () =>
      set((s) => {
        if (!s.future.length) return {};
        const nxt = s.future[s.future.length - 1];
        const past = [...s.past, snap(s.workspace)];
        const ws = structuredClone(s.workspace);
        ws.library = nxt.library;
        ws.boards = nxt.boards;
        scheduleSave(ws);
        return { workspace: ws, past, future: s.future.slice(0, -1) };
      }),

    importData: (data, sourceFile) => {
      const errors = validatePayload(data, get().workspace.library);
      if (errors.length) return { ok: false, errors, libraryIds: [], boardIds: [] };
      let ids = { libraryIds: [] as string[], boardIds: [] as string[] };
      commit((ws) => {
        ids = mergePayload(ws, data as ImportPayload);
        if (sourceFile) ws.loadedDesigns = Array.from(new Set([...(ws.loadedDesigns ?? []), sourceFile]));
      });
      if (ids.boardIds.length) set({ currentBoardId: ids.boardIds[0], selection: [] });
      return { ok: true, errors: [], ...ids };
    },

    addBoard: () => {
      const id = uid();
      commit((ws) =>
        ws.boards.push({
          id, name: `Board ${ws.boards.length + 1}`, type: ws.settings.defaultBoardType,
          cols: 30, rows: 20, activeSide: 'top', modules: [], tracks: [], io: [], annotations: [], nets: [],
          createdAt: Date.now(), updatedAt: Date.now(),
        })
      );
      set({ currentBoardId: id, selection: [] });
    },
    selectBoard: (id) => set({ currentBoardId: id, selection: [], wireDraft: null, railStart: null }),
    updateBoardMeta: (patch) => withBoard((b) => Object.assign(b, patch)),
    deleteBoard: (id) => {
      commit((ws) => { ws.boards = ws.boards.filter((b) => b.id !== id); });
      if (get().currentBoardId === id) set({ currentBoardId: get().workspace.boards[0]?.id ?? null });
    },
    flipBoard: () =>
      set((s) => {
        const ws = structuredClone(s.workspace);
        const b = ws.boards.find((b) => b.id === s.currentBoardId);
        if (b) b.activeSide = b.activeSide === 'top' ? 'bottom' : 'top';
        scheduleSave(ws);
        return { workspace: ws };
      }),

    startNewModule: () =>
      set({
        editingDef: {
          id: uid(), name: 'New Module', cols: 4, rows: 2, pins: [],
          designatorPrefix: 'U', color: '#3b82f6', createdAt: Date.now(), updatedAt: Date.now(),
        },
        view: 'designer',
      }),
    editModule: (id) => {
      const d = get().workspace.library.find((d) => d.id === id);
      if (d) set({ editingDef: structuredClone(d), view: 'designer' });
    },
    setEditingDef: (d) => set({ editingDef: d }),
    saveEditingDef: () => {
      const d = get().editingDef;
      if (!d) return;
      d.updatedAt = Date.now();
      commit((ws) => {
        const i = ws.library.findIndex((x) => x.id === d.id);
        if (i >= 0) ws.library[i] = d; else ws.library.push(d);
      });
      set({ editingDef: null, view: 'board' });
    },
    cancelEditing: () => set({ editingDef: null, view: 'board' }),
    deleteModuleDef: (id) => {
      const used = get().workspace.boards.some((b) => b.modules.some((m) => m.defId === id));
      if (used) { alert('This module is placed on a board. Remove those placements first.'); return; }
      commit((ws) => { ws.library = ws.library.filter((d) => d.id !== id); });
    },

    placeModule: (defId, col, row) => {
      const def = get().workspace.library.find((d) => d.id === defId);
      if (!def) return;
      const id = uid();
      withBoard((b) =>
        b.modules.push({
          id, defId, col, row, rotation: 0, side: 'top',
          designator: nextDesignator(b.modules.map((m) => m.designator), def.designatorPrefix),
        })
      );
      set({ selection: [id], tool: 'select' });
    },
    // Move a module and drag any wires attached to its pins along with it:
    // each track endpoint sitting on one of the module's pins shifts by the
    // same delta, and the track re-routes as a clean orthogonal elbow so the
    // connection is preserved with 90° corners (KiCad-style).
    moveModule: (id, col, row) => withBoard((b, ws) => {
      const m = b.modules.find((m) => m.id === id);
      if (!m) return;
      const dx = col - m.col, dy = row - m.row;
      if (dx === 0 && dy === 0) return;
      const def = ws.library.find((d) => d.id === m.defId);
      const oldPins = new Set<string>();
      if (def) for (const wp of worldPins(m, def)) oldPins.add(holeKey(wp.col, wp.row));
      m.col = col; m.row = row;
      for (const t of b.tracks) {
        if (t.points.length < 2) continue;
        const a = t.points[0], z = t.points[t.points.length - 1];
        const aMove = oldPins.has(holeKey(a.col, a.row));
        const zMove = oldPins.has(holeKey(z.col, z.row));
        if (!aMove && !zMove) continue;
        const na = aMove ? { col: a.col + dx, row: a.row + dy } : { col: a.col, row: a.row };
        const nz = zMove ? { col: z.col + dx, row: z.row + dy } : { col: z.col, row: z.row };
        t.points = orthoElbow(na, nz);
      }
    }),
    rotateModule: (id, dir = 1) =>
      withBoard((b) => {
        const m = b.modules.find((m) => m.id === id);
        if (!m) return;
        const order: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
        const i = order.indexOf(m.rotation);
        m.rotation = order[(i + (dir === 1 ? 1 : 3)) % 4];
      }),
    patchModule: (id, patch) => withBoard((b) => { const m = b.modules.find((m) => m.id === id); if (m) Object.assign(m, patch); }),

    startWire: (h, side) => set({ wireDraft: { points: [h], side } }),
    addWirePoint: (h) =>
      set((s) => {
        if (!s.wireDraft) return {};
        const pts = s.wireDraft.points;
        const last = pts[pts.length - 1];
        if (last && last.col === h.col && last.row === h.row) return {};
        return { wireDraft: { ...s.wireDraft, points: [...pts, h] } };
      }),
    finishWire: () => {
      const d = get().wireDraft;
      // Store wires as orthogonal (H/V) polylines only — never diagonal.
      if (d && d.points.length >= 2) {
        const points = orthogonalize(d.points);
        if (points.length >= 2) withBoard((b) => b.tracks.push({ id: uid(), side: d.side, points }));
      }
      set({ wireDraft: null });
    },
    cancelWire: () => set({ wireDraft: null, railStart: null }),
    railClick: (h, kind) => {
      const start = get().railStart;
      if (!start) { set({ railStart: h }); return; }
      const b = board();
      if (!b) { set({ railStart: null }); return; }
      const pts = expandLine(start, h);
      const color = kind === 'power' ? '#ef4444' : '#111827';
      const name = kind === 'power' ? 'VCC' : 'GND';
      const side = b.activeSide;
      withBoard((bd) => {
        let net = bd.nets.find((n) => n.kind === kind && n.name === name);
        if (!net) { net = { id: uid(), name, color, kind }; bd.nets.push(net); }
        bd.tracks.push({ id: uid(), side, points: pts, netId: net.id, color, rail: true });
      });
      set({ railStart: null });
    },
    addIO: (h, kind) =>
      withBoard((b) =>
        b.io.push({ id: uid(), kind, name: kind === 'input' ? 'IN' : 'OUT', col: h.col, row: h.row })
      ),
    addAnnotation: (h, text) =>
      withBoard((b) => b.annotations.push({ id: uid(), text, col: h.col, row: h.row, side: 'both' })),
    updateTrack: (id, patch) => withBoard((b) => { const t = b.tracks.find((t) => t.id === id); if (t) Object.assign(t, patch); }),
    addNet: (name, color, kind) => {
      const id = uid();
      withBoard((b) => b.nets.push({ id, name, color, kind }));
      return id;
    },
    deleteSelected: () => {
      const sel = new Set(get().selection);
      if (!sel.size) return;
      withBoard((b) => {
        b.modules = b.modules.filter((m) => !sel.has(m.id));
        b.tracks = b.tracks.filter((t) => !sel.has(t.id));
        b.io = b.io.filter((x) => !sel.has(x.id));
        b.annotations = b.annotations.filter((a) => !sel.has(a.id));
      });
      set({ selection: [] });
    },
    deleteEntity: (id) =>
      withBoard((b) => {
        b.modules = b.modules.filter((m) => m.id !== id);
        b.tracks = b.tracks.filter((t) => t.id !== id);
        b.io = b.io.filter((x) => x.id !== id);
        b.annotations = b.annotations.filter((a) => a.id !== id);
      }),
  };
});

export { saveWorkspace };
