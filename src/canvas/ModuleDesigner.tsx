import { useState } from 'react';
import { Stage, Layer, Rect, Circle, Text, Shape } from 'react-konva';
import { useStore } from '../state/store';
import { uid, PIN_TYPES, PIN_TYPE_COLORS, MODULE_PALETTE } from '../util';
import { ModuleDefinition } from '../domain/types';

const SCALE = 46;

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

  const stageW = (def.cols + 1) * SCALE + SCALE;
  const stageH = (def.rows + 1) * SCALE + SCALE;

  return (
    <div className="designer">
      <div className="form">
        <h3 style={{ padding: 0, border: 'none' }}>Module Designer</h3>
        <div className="row">
          <label>Name</label>
          <input type="text" value={def.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="row" style={{ flexDirection: 'row', gap: 8 }}>
          <div><label>Cols</label><br />
            <input type="number" min={1} max={40} value={def.cols}
              onChange={(e) => update({ cols: Math.max(1, Math.min(40, +e.target.value || 1)) })} /></div>
          <div><label>Rows</label><br />
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
        <Stage width={stageW} height={stageH} x={SCALE} y={SCALE} scaleX={SCALE} scaleY={SCALE}
          onClick={(e: any) => {
            const p = e.target.getStage().getRelativePointerPosition();
            const c = Math.round(p.x), r = Math.round(p.y);
            if (c >= 0 && c < def.cols && r >= 0 && r < def.rows) clickHole(c, r);
          }}>
          <Layer>
            <Shape sceneFunc={(ctx: any) => {
              ctx.fillStyle = def.color; ctx.globalAlpha = 0.18;
              ctx.fillRect(-0.5, -0.5, def.cols, def.rows);
              ctx.globalAlpha = 1;
              ctx.strokeStyle = '#334155'; ctx.lineWidth = 0.04;
              ctx.strokeRect(-0.5, -0.5, def.cols, def.rows);
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
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
