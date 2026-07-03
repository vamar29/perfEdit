import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, Tool } from '../state/store';
import { exportWorkspaceJson, downloadJson, fetchDesignIndex, fetchDesign, DesignEntry } from '../state/io';
import { wireLayers } from '../domain/connectivity';
import { bodyRect, toRenderX } from '../domain/geometry';

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: 'select', label: 'Select', title: 'Select / move (V)' },
  { id: 'wire', label: 'Wire', title: 'Draw wire (W) — click holes, double-click to finish' },
  { id: 'rail-power', label: '+V rail', title: 'Power bus rail (red) — click start then end' },
  { id: 'rail-ground', label: 'GND rail', title: 'Ground bus rail (black) — click start then end' },
  { id: 'io-in', label: 'Input', title: 'Add a board input port' },
  { id: 'io-out', label: 'Output', title: 'Add a board output port' },
  { id: 'text', label: 'Text', title: 'Add a text label (T)' },
];

export default function Toolbar() {
  const { workspace, currentBoardId, tool, view } = useStore();
  const s = useStore();
  const board = workspace.boards.find((b) => b.id === currentBoardId);
  const [designs, setDesigns] = useState<DesignEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchDesignIndex().then(setDesigns).catch(() => {}); }, []);

  // Solder-order layers for the side currently shown (only computed in layer view).
  const layers = useMemo(
    () => (board && s.layerView ? wireLayers(board, board.activeSide) : []),
    [board, s.layerView]
  );
  const layerIdx = Math.min(s.layerIndex, Math.max(0, layers.length - 1));
  const curCount = layers[layerIdx]?.length ?? 0;

  // Frame ALL content (including off-board parts like the panel power switch),
  // not just the board grid, so nothing wired in from outside is hidden.
  const fitContent = () => {
    if (!board) return;
    const pitch = workspace.settings.pitchMm || 2.54;
    const flipped = board.activeSide === 'bottom';
    const rx = (c: number) => toRenderX(c, board.cols, flipped);
    let minC = -0.5, maxC = board.cols - 0.5, minR = -1.6, maxR = board.rows - 0.5;
    const ext = (c: number, r: number) => { const x = rx(c); if (x < minC) minC = x; if (x > maxC) maxC = x; if (r < minR) minR = r; if (r > maxR) maxR = r; };
    for (const m of board.modules) { const def = workspace.library.find((d) => d.id === m.defId); if (!def) continue; const rr = bodyRect(m, def, pitch); ext(rr.x, rr.y); ext(rr.x + rr.w, rr.y + rr.h); }
    for (const t of board.tracks) for (const p of t.points) ext(p.col, p.row);
    for (const io of board.io) ext(io.col, io.row);
    const availW = window.innerWidth - 380, availH = window.innerHeight - 150;
    const scale = Math.max(6, Math.min(48, Math.floor(Math.min(availW / (maxC - minC + 2), availH / (maxR - minR + 2)))));
    s.setCamera({ scale, panX: 220 - minC * scale, panY: 96 - minR * scale });
  };

  const applyImport = (data: unknown, source: string) => {
    const res = s.importData(data);
    if (!res.ok) alert(`Import from ${source} failed:\n\n${res.errors.slice(0, 12).join('\n')}`);
  };
  const loadDesign = async (file: string) => {
    try { applyImport(await fetchDesign(file), file); }
    catch (e: any) { alert(`Could not load ${file}: ${e?.message ?? e}`); }
  };
  const onImportFile = async (f: File | undefined) => {
    if (!f) return;
    try { applyImport(JSON.parse(await f.text()), f.name); }
    catch (e: any) { alert(`Could not parse ${f.name}: ${e?.message ?? e}`); }
  };

  return (
    <div className="toolbar">
      <span className="title">perfEdit</span>

      <div className="group">
        <select value={currentBoardId ?? ''} onChange={(e) => s.selectBoard(e.target.value)}>
          {workspace.boards.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button title="New board" onClick={s.addBoard}>+ Board</button>
        {workspace.boards.length > 1 && (
          <button className="danger" title="Delete board"
            onClick={() => board && confirm(`Delete "${board.name}"?`) && s.deleteBoard(board.id)}>✕</button>
        )}
      </div>

      {view === 'board' && (
        <>
          <div className="group">
            {TOOLS.map((t) => (
              <button key={t.id} title={t.title}
                className={tool === t.id ? 'active' : ''}
                onClick={() => s.setTool(t.id)}>{t.label}</button>
            ))}
          </div>

          <div className="group">
            <button title="Flip to the other side (F)" onClick={s.flipBoard}>
              Flip → {board?.activeSide === 'top' ? 'component side' : 'track side'}
            </button>
          </div>

          <div className="group">
            <button className={s.layerView ? 'active' : ''}
              title="Wire layering — step through the solder order. Layer 1 = wires that cross over nothing; each later layer stacks on top."
              onClick={() => s.setLayerView(!s.layerView)}>Layers</button>
            {s.layerView && (
              layers.length > 0 ? (
                <>
                  <button title="Previous layer" disabled={layerIdx <= 0}
                    onClick={() => s.setLayerIndex(layerIdx - 1)}>◀</button>
                  <span className="saved">Layer {layerIdx + 1}/{layers.length} · {curCount} wire{curCount === 1 ? '' : 's'}</span>
                  <button title="Next layer" disabled={layerIdx >= layers.length - 1}
                    onClick={() => s.setLayerIndex(layerIdx + 1)}>▶</button>
                </>
              ) : <span className="saved">no wires on this side</span>
            )}
          </div>

          <div className="group">
            <button title="Undo (⌘Z)" onClick={s.undo} disabled={!s.past.length}>↶ Undo</button>
            <button title="Redo (⌘⇧Z)" onClick={s.redo} disabled={!s.future.length}>↷ Redo</button>
          </div>

          <div className="group">
            <button title="Shift overlapping wires apart until the overlap check is clean"
              onClick={() => { const r = s.autoFixOverlaps(); if (r.fixed || r.remaining) alert(`Fixed ${r.fixed} wire overlap(s)${r.remaining ? `, ${r.remaining} left (need manual routing)` : ' — all clear'}.`); }}>
              Fix overlaps
            </button>
          </div>

          <div className="group">
            <button title="Frame the whole board and any off-board parts" onClick={fitContent}>Fit all</button>
          </div>
        </>
      )}

      <div className="group">
        <button onClick={s.startNewModule}>+ New Module</button>
      </div>

      <div className="group">
        {designs.length > 0 && (
          <select value="" title="Load a bundled design (merges by id)"
            onChange={(e) => { if (e.target.value) loadDesign(e.target.value); }}>
            <option value="">Designs…</option>
            {designs.map((d) => <option key={d.file} value={d.file}>{d.name}</option>)}
          </select>
        )}
        <button title="Import a workspace/design JSON file (merges by id)"
          onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
          onChange={(e) => { onImportFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button title="Download the whole workspace as JSON"
          onClick={() => downloadJson('perfedit-workspace.json', exportWorkspaceJson(workspace))}>Export</button>
      </div>

      <span className="spacer" />
      <span className="saved">
        {board ? `${board.activeSide === 'top' ? 'Component' : 'Track'} side · ${board.cols}×${board.rows} · auto-saved` : ''}
      </span>
    </div>
  );
}
