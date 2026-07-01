import { useStore, Tool } from '../state/store';

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
            <button title="Undo (⌘Z)" onClick={s.undo} disabled={!s.past.length}>↶ Undo</button>
            <button title="Redo (⌘⇧Z)" onClick={s.redo} disabled={!s.future.length}>↷ Redo</button>
          </div>

          <div className="group">
            <button onClick={() => s.setCamera({ scale: 24, panX: 70, panY: 70 })}>Reset view</button>
          </div>
        </>
      )}

      <div className="group">
        <button onClick={s.startNewModule}>+ New Module</button>
      </div>

      <span className="spacer" />
      <span className="saved">
        {board ? `${board.activeSide === 'top' ? 'Component' : 'Track'} side · ${board.cols}×${board.rows} · auto-saved` : ''}
      </span>
    </div>
  );
}
