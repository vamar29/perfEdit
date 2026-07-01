import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Circle, Rect, Text, Group, Shape } from 'react-konva';
import { useStore } from '../state/store';
import { analyze } from '../domain/connectivity';
import { worldPins, bodyRect, rotatedSize, toRenderX, holeKey } from '../domain/geometry';
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
  const s = useStore();
  const board = s.workspace.boards.find((b) => b.id === s.currentBoardId);
  const library = s.workspace.library;
  const { rootByHole, issues } = useMemo(
    () => (board ? analyze(board, library) : { rootByHole: new Map(), issues: [] }),
    [board, library]
  );

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
      case 'wire': if (!s.wireDraft) s.startWire(h, board.activeSide); else s.addWirePoint(h); break;
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

  // ---- draft wire polyline ----
  const draftPoints: number[] = [];
  if (s.wireDraft) {
    for (const p of s.wireDraft.points) draftPoints.push(rx(p.col), p.row);
    if (s.hoverHole) draftPoints.push(rx(s.hoverHole.col), s.hoverHole.row);
  }

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
            const pts: number[] = [];
            for (const p of t.points) pts.push(rx(p.col), p.row);
            const ghost = t.side !== board.activeSide;
            const root = t.points[0] ? rootByHole.get(holeKey(t.points[0].col, t.points[0].row)) : undefined;
            const hot = hoveredRoot !== undefined && root === hoveredRoot;
            const selected = s.selection.includes(t.id);
            const color = t.color || netColor(t.netId) || '#cbd5e1';
            return (
              <Line key={t.id} points={pts}
                stroke={selected ? '#2563eb' : color}
                strokeWidth={(t.rail ? 0.34 : 0.17) * (hot ? 1.7 : 1)}
                opacity={ghost ? 0.28 : 1}
                dash={ghost ? [0.4, 0.3] : undefined}
                lineCap="round" lineJoin="round"
                hitStrokeWidth={0.7}
                shadowColor={hot ? '#fde047' : undefined} shadowBlur={hot ? 8 : 0}
                onClick={(e) => { if (s.tool === 'select') { e.cancelBubble = true; s.toggleSelect(t.id, e.evt.shiftKey); } }}
              />
            );
          })}
        </Layer>

        {/* Modules */}
        <Layer>
          {board.modules.map((m) => {
            const def = defOf(m.defId);
            if (!def) return null;
            const br = bodyRect(m, def);
            const bx = rx(flipped ? br.x + br.w : br.x); // left edge in render space
            const selected = s.selection.includes(m.id);
            const size2 = rotatedSize(def, m.rotation);
            return (
              <Group key={m.id} x={0} y={0}
                draggable={s.tool === 'select' && !flipped}
                onDragStart={(e) => { e.cancelBubble = true; s.setSelection([m.id]); }}
                onDragMove={(e) => { const n = e.target; n.x(Math.round(n.x())); n.y(Math.round(n.y())); }}
                onDragEnd={(e) => {
                  const n = e.target; const dx = Math.round(n.x()); const dy = Math.round(n.y());
                  n.position({ x: 0, y: 0 });
                  if (dx || dy) s.moveModule(m.id, m.col + dx, m.row + dy);
                }}
                onClick={(e) => { if (s.tool === 'select') { e.cancelBubble = true; s.toggleSelect(m.id, e.evt.shiftKey); } }}
              >
                <Rect x={bx} y={br.y} width={br.w} height={br.h} cornerRadius={0.18}
                  fill={flipped ? undefined : def.color} opacity={flipped ? 1 : 0.9}
                  stroke={selected ? '#2563eb' : flipped ? '#334155' : '#1e293b'}
                  strokeWidth={selected ? 0.12 : 0.05}
                  dash={flipped ? [0.35, 0.25] : undefined} />
                {worldPins(m, def).map((wp) => {
                  const on = matches(wp.col, wp.row);
                  return (
                    <Group key={wp.pin.id}>
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
                  visible={size2.cols >= 2} />
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
