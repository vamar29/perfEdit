import { useMemo } from 'react';
import { useStore } from '../state/store';
import { analyze } from '../domain/connectivity';
import { toRenderX } from '../domain/geometry';

export default function IssuesPanel() {
  const s = useStore();
  const board = s.workspace.boards.find((b) => b.id === s.currentBoardId);
  const library = s.workspace.library;
  const issues = useMemo(() => (board ? analyze(board, library).issues : []), [board, library]);

  if (!board) return null;

  const focus = (col?: number, row?: number) => {
    if (col == null || row == null) return;
    const flipped = board.activeSide === 'bottom';
    const rx = toRenderX(col, board.cols, flipped);
    s.setCamera({ panX: window.innerWidth * 0.4 - rx * s.scale, panY: window.innerHeight * 0.45 - row * s.scale });
    s.setHoverHole({ col, row });
  };

  return (
    <div className="panel" style={{ flex: 1 }}>
      <h3>Issues {issues.length ? `(${issues.length})` : ''}</h3>
      {issues.length === 0 && <div className="ok">✓ No problems detected</div>}
      {issues.map((i) => (
        <div key={i.id} className={`issue ${i.severity}`} onClick={() => focus(i.col, i.row)}>
          <span className="dot" />
          <span>{i.message}{i.col != null ? ` @ col ${i.col}, row ${i.row}` : ''}</span>
        </div>
      ))}
    </div>
  );
}
