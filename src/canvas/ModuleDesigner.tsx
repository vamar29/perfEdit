import { useState } from 'react';
import { Stage, Layer, Circle, Text, Shape, Rect } from 'react-konva';
import { useStore } from '../state/store';
import { uid, PIN_TYPES, PIN_TYPE_COLORS, MODULE_PALETTE } from '../util';
import { ModuleDefinition } from '../domain/types';
import { DEFAULT_PITCH_MM } from '../domain/geometry';

const SCALE = 46;
const P = DEFAULT_PITCH_MM;

/** The legacy auto body (0.45-hole pad around the pin grid), expressed in mm. */
const autoBody = (def: ModuleDefinition) => ({
  w: +((def.cols - 1 + 0.9) * P).toFixed(2),
  h: +((def.rows - 1 + 0.9) * P).toFixed(2),
  dx: +(-0.45 * P).toFixed(2),
  dy: +(-0.45 * P).toFixed(2),
});

export default function ModuleDesigner() {
  const s = useStore();
  const def = s.editingDef;
  const [selPin, setSelPin] = useState<string | null>(null);
  if (!def) return null;

  const update = (patch: Partial<ModuleDefinition>) => s.setEditingDef({ ...def, ...patch });
  const pin = def.pins.find((p) => p.id === selPin) || null;

  const clickHole = (c: number, r: number) => {
    const existing = def.pins.find((p) => p.col === c && p.row === r);
    if (existing) { setSelPin(existing.id); return; }
    const np = { id: uid(), col: c, row: r, type: 'passive' as const, name: String(def.pins.length + 1) };
    update({ pins: [...def.pins, np] });
    setSelPin(np.id);
  };
  const patchPin = (patch: any) => update({ pins: def.pins.map((p) => (p.id === selPin ? { ...p, ...patch } : p)) });
  const deletePin = () => { update({ pins: def.pins.filter((p) => p.id !== selPin) }); setSelPin(null); };

  const body = def.bodyMm;
  const patchBody = (patch: Partial<NonNullable<ModuleDefinition['bodyMm']>>) =>
    update({ bodyMm: { ...(body ?? autoBody(def)), ...patch } });
  const centerBody = () => {
    const b = body ?? autoBody(def);
    update({
      bodyMm: {
        ...b,
        dx: +(-(b.w - (def.cols - 1) * P) / 2).toFixed(2),
        dy: +(-(b.h - (def.rows - 1) * P) / 2).toFixed(2),
      },
    });
  };

  // Stage bounds must include the body outline, which may extend past the pin grid.
  const bx0 = body ? body.dx / P : -0.5, by0 = body ? body.dy / P : -0.5;
  const bx1 = body ? (body.dx + body.w) / P : def.cols - 0.5;
  const by1 = body ? (body.dy + body.h) / P : def.rows - 0.5;
  const minX = Math.min(-0.5, bx0), minY = Math.min(-0.5, by0);
  const maxX = Math.max(def.cols - 0.5, bx1), maxY = Math.max(def.rows - 0.5, by1);
  const stageW = (maxX - minX + 1) * SCALE + SCALE;
  const stageH = (maxY - minY + 1) * SCALE + SCALE;

  return (
    <div className="designer">
      <div className="form">
        <h3 style={{ padding: 0, border: 'none' }}>Module Designer</h3>
        <div className="row">
          <label>Name</label>
          <input type="text" value={def.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="row" style={{ flexDirection: 'row', gap: 8 }}>
          <div><label>Pin-grid cols</label><br />
            <input type="number" min={1} max={40} value={def.cols}
              onChange={(e) => update({ cols: Math.max(1, Math.min(40, +e.target.value || 1)) })} /></div>
          <div><label>Pin-grid rows</label><br />
            <input type="number" min={1} max={40} value={def.rows}
              onChange={(e) => update({ rows: Math.max(1, Math.min(40, +e.target.value || 1)) })} /></div>
        </div>
        <div className="row">
          <label>Designator prefix</label>
          <input type="text" value={def.designatorPrefix} onChange={(e) => update({ designatorPrefix: e.target.value })} />
        </div>
        <div className="row">
          <label>Body color</label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {MODULE_PALETTE.map((c) => (
              <div key={c} onClick={() => update({ color: c })}
                style={{ width: 20, height: 20, borderRadius: 4, background: c, cursor: 'pointer', outline: def.color === c ? '2px solid #1e293b' : 'none' }} />
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', margin: '10px 0', paddingTop: 8 }}>
          <div className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={!!body}
              onChange={(e) => update({ bodyMm: e.target.checked ? autoBody(def) : undefined })} />
            <label style={{ margin: 0 }}>Physical body size (mm)</label>
          </div>
          {!body && (
            <div className="hint">
              Auto: body hugs the pin grid ({((def.cols - 1 + 0.9) * P).toFixed(1)} × {((def.rows - 1 + 0.9) * P).toFixed(1)} mm).
              Enable to set the real outline — most modules are larger than their pins.
            </div>
          )}
          {body && (
            <>
              <div className="row" style={{ flexDirection: 'row', gap: 8 }}>
                <div><label>Width mm</label><br />
                  <input type="number" step={0.1} value={body.w} onChange={(e) => patchBody({ w: +e.target.value || 0 })} /></div>
                <div><label>Height mm</label><br />
                  <input type="number" step={0.1} value={body.h} onChange={(e) => patchBody({ h: +e.target.value || 0 })} /></div>
              </div>
              <div className="row" style={{ flexDirection: 'row', gap: 8 }}>
                <div><label>Offset X mm</label><br />
                  <input type="number" step={0.1} value={body.dx} onChange={(e) => patchBody({ dx: +e.target.value || 0 })} /></div>
                <div><label>Offset Y mm</label><br />
                  <input type="number" step={0.1} value={body.dy} onChange={(e) => patchBody({ dy: +e.target.value || 0 })} /></div>
              </div>
              <div className="hint">Offsets place the body's top-left corner relative to the center of pin-grid hole (0,0) — usually negative.</div>
              <button onClick={centerBody}>Center body on pin grid</button>
            </>
          )}
          <div className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <input type="checkbox" checked={!!def.mayOverhang}
              onChange={(e) => update({ mayOverhang: e.target.checked || undefined })} />
            <label style={{ margin: 0 }} title="Edge connectors etc. — suppresses the board-edge overhang warning">
              May overhang board edge
            </label>
          </div>
          <div className="row">
            <label>Notes</label>
            <textarea rows={3} value={def.notes ?? ''} placeholder="Datasheet caveats, approximations, purchase link…"
              onChange={(e) => update({ notes: e.target.value || undefined })} />
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', margin: '10px 0', paddingTop: 10 }}>
          <div className="hint">Click a hole in the grid to add or select a pin.</div>
        </div>

        {pin && (
          <div style={{ background: '#f8fafc', padding: 8, borderRadius: 8 }}>
            <div className="row"><label>Pin name</label>
              <input type="text" value={pin.name} onChange={(e) => patchPin({ name: e.target.value })} /></div>
            <div className="row"><label>Type</label>
              <select value={pin.type} onChange={(e) => patchPin({ type: e.target.value })}>
                {PIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className="row"><label>Label</label>
              <input type="text" value={pin.label ?? ''} onChange={(e) => patchPin({ label: e.target.value || undefined })} /></div>
            <button className="danger" onClick={deletePin}>Delete pin</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="active" onClick={s.saveEditingDef}>Save to library</button>
          <button onClick={s.cancelEditing}>Cancel</button>
        </div>
      </div>

      <div className="canvas">
        <Stage width={stageW} height={stageH}
          x={(0.5 - minX) * SCALE + SCALE / 2} y={(0.5 - minY) * SCALE + SCALE / 2}
          scaleX={SCALE} scaleY={SCALE}
          onClick={(e: any) => {
            const p = e.target.getStage().getRelativePointerPosition();
            const c = Math.round(p.x), r = Math.round(p.y);
            if (c >= 0 && c < def.cols && r >= 0 && r < def.rows) clickHole(c, r);
          }}>
          <Layer>
            {/* Physical body outline (may extend past the pin grid) */}
            {body && (
              <Rect x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} cornerRadius={0.15}
                fill={def.color} opacity={0.25} stroke={def.color} strokeWidth={0.06} />
            )}
            <Shape sceneFunc={(ctx: any) => {
              // Pin grid: dashed reference when a physical body is set, filled otherwise.
              if (!body) { ctx.fillStyle = def.color; ctx.globalAlpha = 0.18; ctx.fillRect(-0.5, -0.5, def.cols, def.rows); ctx.globalAlpha = 1; }
              ctx.strokeStyle = '#334155'; ctx.lineWidth = 0.04;
              if (body) ctx.setLineDash([0.25, 0.2]);
              ctx.strokeRect(-0.5, -0.5, def.cols, def.rows);
              ctx.setLineDash([]);
              for (let c = 0; c < def.cols; c++)
                for (let r = 0; r < def.rows; r++) {
                  ctx.beginPath(); ctx.arc(c, r, 0.12, 0, Math.PI * 2);
                  ctx.fillStyle = '#94a3b8'; ctx.fill();
                }
            }} />
            {def.pins.map((p) => (
              <Circle key={p.id} x={p.col} y={p.row} radius={0.32}
                fill={PIN_TYPE_COLORS[p.type]} stroke={selPin === p.id ? '#2563eb' : '#0f172a'}
                strokeWidth={selPin === p.id ? 0.12 : 0.05} />
            ))}
            {def.pins.map((p) => (
              <Text key={'t' + p.id} x={p.col - 0.5} y={p.row - 0.18} width={1} align="center"
                text={p.name} fontSize={0.3} fill="#fff" listening={false} />
            ))}
            {body && (
              <Text x={bx0} y={by1 + 0.25} width={Math.max(bx1 - bx0, 4)}
                text={`${body.w} × ${body.h} mm`} fontSize={0.38} fill="#475569" listening={false} />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
