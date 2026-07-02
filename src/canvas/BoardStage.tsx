import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Circle, Rect, Text, Group, Shape } from 'react-konva';
import { useStore } from '../state/store';
import { analyze, wireLayers } from '../domain/connectivity';
import { worldPins, bodyRect, toRenderX, holeKey, orthogonalize, orthoElbow, dragSegment, segmentsOf, nearestSegmentIndex } from '../domain/geometry';
import { colName, PIN_TYPE_COLORS } from '../util';
import { Hole } from '../domain/types';

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 640 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Bail when the rounded size is unchanged so a stable layout can't loop.
    const measure = () => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function BoardStage() {
  const [wrapRef, size] = useElementSize();
  const wireGrab = useRef<{ seg: number; start: Hole } | null>(null);
  const s = useStore();
  const board = s.workspace.boards.find((b) => b.id === s.currentBoardId);
  const library = s.workspace.library;
  const pitch = s.workspace.settings.pitchMm || 2.54;
  const { rootByHole, issues } = useMemo(
    () => (board ? analyze(board, library, pitch) : { rootByHole: new Map(), issues: [] }),
    [board, library, pitch]
  );
  // Board holes occupied by a module pin — a wire that reaches one should terminate.
  const pinHoleSet = useMemo(() => {
    const set = new Set<string>();
    if (board)
      for (const m of board.modules) {
        const def = library.find((d) => d.id === m.defId);
        if (def) for (const wp of worldPins(m, def)) set.add(holeKey(wp.col, wp.row));
      }
    return set;
  }, [board, library]);

  if (!board) {
    return <div ref={wrapRef} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#64748b' }}>
      No board — create one from the toolbar.
    </div>;
  }

  const W = board.cols, H = board.rows;
  const flipped = board.activeSide === 'bottom';
  const { scale, panX, panY } = s;
  const rx = (dataCol: number) => toRenderX(dataCol, W, flipped);

  const toDataHole = (rc: number, rr: number): Hole => ({
    col: clamp(flipped ? W - 1 - rc : rc, 0, W - 1),
    row: clamp(rr, 0, H - 1),
  });
  const pointerHole = (stage: any): Hole | null => {
    const p = stage.getRelativePointerPosition();
    if (!p) return null;
    return toDataHole(Math.round(p.x), Math.round(p.y));
  };
  const defOf = (defId: string) => library.find((d) => d.id === defId);
  const netColor = (id?: string) => (id ? board.nets.find((n) => n.id === id)?.color : undefined);
  const hoveredRoot = s.hoverHole ? rootByHole.get(holeKey(s.hoverHole.col, s.hoverHole.row)) : undefined;
  const matches = (col: number, row: number) =>
    hoveredRoot !== undefined && rootByHole.get(holeKey(col, row)) === hoveredRoot;

  // ---- interaction ----
  const onMove = (e: any) => {
    const stage = e.target.getStage();
    const h = pointerHole(stage);
    if (h) s.setHoverHole(h);
  };
  const onClick = (e: any) => {
    const stage = e.target.getStage();
    const h = pointerHole(stage);
    if (!h) return;
    switch (s.tool) {
      case 'select': if (e.target === stage && !e.evt.shiftKey) s.setSelection([]); break;
      case 'wire':
        if (!s.wireDraft) {
          s.startWire(h, board.activeSide);
        } else {
          s.addWirePoint(h);
          // Reaching a pin ends the wire (a pin is normally a terminal), then back to Select.
          if (pinHoleSet.has(holeKey(h.col, h.row))) { s.finishWire(); s.setTool('select'); }
        }
        break;
      case 'rail-power': s.railClick(h, 'power'); break;
      case 'rail-ground': s.railClick(h, 'ground'); break;
      case 'io-in': s.addIO(h, 'input'); break;
      case 'io-out': s.addIO(h, 'output'); break;
      case 'text': { const t = prompt('Label text:'); if (t) s.addAnnotation(h, t); break; }
    }
  };
  const onDbl = () => { if (s.tool === 'wire') s.finishWire(); };
  const onWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const pointer = stage.getPointerPosition();
      const worldX = (pointer.x - panX) / scale;
      const worldY = (pointer.y - panY) / scale;
      const ns = clamp(e.evt.deltaY < 0 ? scale * 1.08 : scale / 1.08, 6, 90);
      s.setCamera({ scale: ns, panX: pointer.x - worldX * ns, panY: pointer.y - worldY * ns });
    } else {
      s.setCamera({ panX: panX - e.evt.deltaX, panY: panY - e.evt.deltaY });
    }
  };

  // ---- draft wire polyline (orthogonal preview incl. the live hover segment) ----
  const draftPoints: number[] = [];
  if (s.wireDraft) {
    const chain = s.hoverHole ? [...s.wireDraft.points, s.hoverHole] : s.wireDraft.points;
    for (const p of orthogonalize(chain)) draftPoints.push(rx(p.col), p.row);
  }

  // ---- wire layering view: which layer each active-side track is in ----
  const layers = useMemo(
    () => (board && s.layerView ? wireLayers(board, board.activeSide) : []),
    [board, s.layerView]
  );
  const layerView = s.layerView && layers.length > 0;
  const curLayerIdx = Math.min(s.layerIndex, Math.max(0, layers.length - 1));
  const layerOf = useMemo(() => {
    const m = new Map<string, number>();
    layers.forEach((ids, i) => ids.forEach((id) => m.set(id, i)));
    return m;
  }, [layers]);

  // ---- live drag: pins of the module being dragged, in DATA holes ----
  const dragging = s.drag;
  const dragPinKeys = new Set<string>();
  if (dragging) {
    const dm = board.modules.find((m) => m.id === dragging.id);
    const dd = dm ? defOf(dm.defId) : undefined;
    if (dm && dd) for (const wp of worldPins(dm, dd)) dragPinKeys.add(holeKey(wp.col, wp.row));
  }
  // Re-route a track's connected endpoints to follow a live drag (display only).
  const livePoints = (t: typeof board.tracks[number]) => {
    if (!dragging || dragPinKeys.size === 0 || t.points.length < 2) return t.points;
    const a = t.points[0], z = t.points[t.points.length - 1];
    const aMove = dragPinKeys.has(holeKey(a.col, a.row));
    const zMove = dragPinKeys.has(holeKey(z.col, z.row));
    if (!aMove && !zMove) return t.points;
    const na = aMove ? { col: a.col + dragging.dx, row: a.row + dragging.dy } : a;
    const nz = zMove ? { col: z.col + dragging.dx, row: z.row + dragging.dy } : z;
    return orthoElbow(na, nz);
  };

  const boardBg = board.type === 'pad-per-hole' ? '#0f766e' : '#0e7a5f';

  return (
    <div ref={wrapRef} className="board-host"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={(e) => {
        e.preventDefault();
        const defId = e.dataTransfer.getData('text/plain');
        if (!defId) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const rc = Math.round((e.clientX - rect.left - panX) / scale);
        const rr = Math.round((e.clientY - rect.top - panY) / scale);
        const h = toDataHole(rc, rr);
        s.placeModule(defId, h.col, h.row);
      }}
    >
      <Stage
        width={size.width} height={size.height}
        x={panX} y={panY} scaleX={scale} scaleY={scale}
        onMouseMove={onMove} onClick={onClick} onTap={onClick} onDblClick={onDbl}
        onWheel={onWheel} onMouseLeave={() => s.setHoverHole(null)}
      >
        {/* Grid */}
        <Layer listening={false}>
          <Shape
            sceneFunc={(ctx: any) => {
              ctx.fillStyle = boardBg;
              ctx.fillRect(-0.5, -0.5, W, H);
              ctx.strokeStyle = 'rgba(0,0,0,0.35)';
              ctx.lineWidth = 0.03;
              ctx.strokeRect(-0.5, -0.5, W, H);
              for (let c = 0; c < W; c++) {
                for (let r = 0; r < H; r++) {
                  if (board.type === 'pad-per-hole') {
                    ctx.beginPath(); ctx.arc(c, r, 0.34, 0, Math.PI * 2);
                    ctx.fillStyle = '#d4af37'; ctx.fill();
                  }
                  ctx.beginPath(); ctx.arc(c, r, 0.14, 0, Math.PI * 2);
                  ctx.fillStyle = '#0b3d2e'; ctx.fill();
                }
              }
            }}
          />
          {Array.from({ length: W }, (_, c) => (
            <Text key={'cl' + c} x={c - 0.5} y={-1.25} width={1} align="center"
              text={colName(flipped ? W - 1 - c : c)} fontSize={0.55} fill="#475569" listening={false} />
          ))}
          {Array.from({ length: H }, (_, r) => (
            <Text key={'rl' + r} x={-1.6} y={r - 0.3} width={1.1} align="right"
              text={String(r + 1)} fontSize={0.55} fill="#475569" listening={false} />
          ))}
        </Layer>

        {/* Tracks & rails */}
        <Layer>
          {board.tracks.map((t) => {
            // In layer view: only the active side is soldered; hide the other.
            // Current layer solid; earlier (already-soldered) layers dim; later
            // layers faintest — so you see the stack order at a glance.
            let layerFactor = 1;
            if (layerView) {
              if (t.side !== board.activeSide) return null;
              const li = layerOf.get(t.id);
              if (li == null) return null;
              layerFactor = li === curLayerIdx ? 1 : li < curLayerIdx ? 0.22 : 0.07;
            }
            const pts: number[] = [];
            // Render every track as orthogonal (H/V) even if older data stored a
            // diagonal. While a module is dragged, its connected endpoints follow
            // live; while THIS wire's segment is dragged, preview the new route.
            const wd = s.wireDrag && s.wireDrag.id === t.id ? s.wireDrag : null;
            const displayPts = wd
              ? dragSegment(t.points, wd.seg, { col: wd.dx, row: wd.dy })
              : orthogonalize(livePoints(t));
            for (const p of displayPts) pts.push(rx(p.col), p.row);
            const ghost = t.side !== board.activeSide;
            const root = t.points[0] ? rootByHole.get(holeKey(t.points[0].col, t.points[0].row)) : undefined;
            const hot = hoveredRoot !== undefined && root === hoveredRoot;
            const selected = s.selection.includes(t.id);
            const color = t.color || netColor(t.netId) || '#cbd5e1';
            return (
              <Line key={t.id} points={pts}
                stroke={selected ? '#2563eb' : color}
                strokeWidth={(t.rail ? 0.34 : 0.17) * (hot ? 1.7 : 1) * (selected ? 2 : 1)}
                opacity={(ghost && !selected ? 0.28 : 1) * layerFactor}
                dash={ghost && !selected ? [0.4, 0.3] : undefined}
                lineCap="round" lineJoin="round"
                hitStrokeWidth={0.7}
                shadowColor={selected ? '#2563eb' : hot ? '#fde047' : undefined} shadowBlur={selected ? 10 : hot ? 8 : 0}
                // Drag anywhere along the wire to move that segment; terminals on
                // pins stay put and new joints are inserted (KiCad-style).
                draggable={s.tool === 'select' && layerFactor === 1}
                listening={layerFactor === 1}
                onClick={(e) => { if (s.tool === 'select') { e.cancelBubble = true; s.toggleSelect(t.id, e.evt.shiftKey); } }}
                onDragStart={(e) => {
                  e.cancelBubble = true;
                  const h = pointerHole(e.target.getStage());
                  wireGrab.current = h ? { seg: nearestSegmentIndex(t.points, h), start: h } : null;
                  s.setSelection([t.id]);
                }}
                onDragMove={(e) => {
                  e.target.position({ x: 0, y: 0 }); // hold the node; preview via state
                  const h = pointerHole(e.target.getStage());
                  const g = wireGrab.current;
                  if (!h || !g || g.seg < 0) return;
                  const sg = segmentsOf(t.points).find((x) => x.i === g.seg);
                  if (!sg) return;
                  const raw = { col: h.col - g.start.col, row: h.row - g.start.row };
                  const d = sg.orient === 'h' ? { col: 0, row: raw.row } : { col: raw.col, row: 0 };
                  s.setWireDrag({ id: t.id, seg: g.seg, dx: d.col, dy: d.row });
                }}
                onDragEnd={(e) => {
                  e.target.position({ x: 0, y: 0 });
                  const w = s.wireDrag; s.setWireDrag(null); wireGrab.current = null;
                  if (w && w.id === t.id) s.commitWireDrag(t.id, w.seg, w.dx, w.dy);
                }}
              />
            );
          })}
        </Layer>

        {/* Modules */}
        <Layer>
          {board.modules.map((m) => {
            const def = defOf(m.defId);
            if (!def) return null;
            const br = bodyRect(m, def, pitch);
            const bx = rx(flipped ? br.x + br.w : br.x); // left edge in render space
            const selected = s.selection.includes(m.id);
            return (
              <Group key={m.id}
                draggable={s.tool === 'select'}
                onDragStart={(e) => { e.cancelBubble = true; s.setSelection([m.id]); }}
                onDragMove={(e) => {
                  // Snap the dragged group to the hole grid and publish the delta
                  // in DATA holes so connected wires follow live. Render X is
                  // mirrored on the track side, so invert dx when flipped.
                  const n = e.target; const rdx = Math.round(n.x()); const rdy = Math.round(n.y());
                  n.x(rdx); n.y(rdy);
                  s.setDrag({ id: m.id, dx: flipped ? -rdx : rdx, dy: rdy });
                }}
                onDragEnd={(e) => {
                  const n = e.target; const rdx = Math.round(n.x()); const rdy = Math.round(n.y());
                  n.position({ x: 0, y: 0 });
                  s.setDrag(null);
                  const dx = flipped ? -rdx : rdx;
                  if (dx || rdy) s.moveModule(m.id, m.col + dx, m.row + rdy);
                }}
                onClick={(e) => { if (s.tool === 'select') { e.cancelBubble = true; s.toggleSelect(m.id, e.evt.shiftKey); } }}
              >
                {/* On the track side, only the border grabs the module (fill is
                    non-listening) so wires inside its bounds stay draggable. */}
                <Rect x={bx} y={br.y} width={br.w} height={br.h} cornerRadius={0.18}
                  fill={flipped ? undefined : def.color} opacity={flipped ? 1 : 0.9}
                  fillEnabled={!flipped}
                  hitStrokeWidth={flipped ? 0.6 : undefined}
                  stroke={selected ? '#2563eb' : flipped ? '#334155' : '#1e293b'}
                  strokeWidth={selected ? 0.12 : 0.05}
                  dash={flipped ? [0.35, 0.25] : undefined} />
                {worldPins(m, def).map((wp) => {
                  const on = matches(wp.col, wp.row);
                  return (
                    <Group key={wp.pin.id} listening={!flipped}>
                      {on && <Circle x={rx(wp.col)} y={wp.row} radius={0.42} stroke="#facc15" strokeWidth={0.1} />}
                      <Circle x={rx(wp.col)} y={wp.row} radius={0.27}
                        fill={PIN_TYPE_COLORS[wp.pin.type] || '#94a3b8'} stroke="#0b3d2e" strokeWidth={0.04} />
                      {scale >= 20 && (
                        <Text x={rx(wp.col) - 0.5} y={wp.row + 0.3} width={1} align="center"
                          text={wp.pin.name} fontSize={0.3} fill="#f8fafc" listening={false} />
                      )}
                    </Group>
                  );
                })}
                <Text x={bx} y={br.y + br.h / 2 - 0.55} width={br.w} align="center"
                  text={m.designator} fontSize={0.62} fontStyle="bold"
                  fill={flipped ? '#e2e8f0' : '#fff'} listening={false} />
                <Text x={bx} y={br.y + br.h / 2 + 0.12} width={br.w} align="center"
                  text={m.labelOverride || def.name} fontSize={0.34}
                  fill={flipped ? '#94a3b8' : 'rgba(255,255,255,0.85)'} listening={false}
                  visible={br.w >= 1.8} />
              </Group>
            );
          })}
        </Layer>

        {/* Ports, annotations, draft, issue markers */}
        <Layer>
          {board.io.map((io) => {
            const selected = s.selection.includes(io.id);
            const on = matches(io.col, io.row);
            return (
              <Group key={io.id}
                onClick={(e) => { if (s.tool === 'select') { e.cancelBubble = true; s.toggleSelect(io.id, e.evt.shiftKey); } }}>
                <Rect x={rx(io.col) - 0.4} y={io.row - 0.4} width={0.8} height={0.8} cornerRadius={0.4}
                  fill={io.kind === 'input' ? '#0ea5e9' : '#f97316'}
                  stroke={selected ? '#2563eb' : on ? '#facc15' : '#0f172a'} strokeWidth={selected || on ? 0.12 : 0.05} />
                <Text x={rx(io.col) - 1.5} y={io.row - 1.15} width={3} align="center"
                  text={`${io.name} (${io.kind === 'input' ? 'in' : 'out'})`} fontSize={0.42} fill="#0f172a" listening={false} />
              </Group>
            );
          })}
          {board.annotations.map((a) => (
            <Text key={a.id} x={rx(a.col)} y={a.row - 0.3} text={a.text} fontSize={0.6} fill={a.color || '#0f172a'}
              fontStyle="bold"
              onClick={(e) => { if (s.tool === 'select') { e.cancelBubble = true; s.toggleSelect(a.id, e.evt.shiftKey); } }} />
          ))}
          {s.wireDraft && (
            <Line points={draftPoints} stroke="#2563eb" strokeWidth={0.16} dash={[0.35, 0.25]} lineCap="round" lineJoin="round" listening={false} />
          )}
          {issues.filter((i) => i.severity === 'error' && i.col != null).map((i) => (
            <Circle key={i.id} x={rx(i.col!)} y={i.row!} radius={0.5} stroke="#dc2626" strokeWidth={0.12} listening={false} />
          ))}
          {s.hoverHole && s.tool !== 'select' && (
            <Circle x={rx(s.hoverHole.col)} y={s.hoverHole.row} radius={0.4} stroke="#2563eb" strokeWidth={0.08} listening={false} />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
