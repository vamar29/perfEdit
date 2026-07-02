import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { useStore } from './state/store';
import { saveWorkspace } from './state/persistence';
import { exportWorkspaceJson, fetchDesign, fetchDesignIndex } from './state/io';
import { analyze } from './domain/connectivity';

// Flush to disk on close, and ask the browser to keep our data durable.
window.addEventListener('beforeunload', () => saveWorkspace(useStore.getState().workspace));
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

// Programmatic surface for automation (browser console / driving agents).
// Documented in AGENTS.md; kept tiny and read-mostly.
(window as any).perfEdit = {
  getWorkspace: () => useStore.getState().workspace,
  exportJson: () => exportWorkspaceJson(useStore.getState().workspace),
  importData: (data: unknown, sourceFile?: string) => useStore.getState().importData(data, sourceFile),
  listBoards: () =>
    useStore.getState().workspace.boards.map((b) => ({ id: b.id, name: b.name, cols: b.cols, rows: b.rows })),
  selectBoard: (id: string) => useStore.getState().selectBoard(id),
  /** Move a placed module to (col,row); connected wires follow and re-route orthogonally. */
  moveModule: (id: string, col: number, row: number) => useStore.getState().moveModule(id, col, row),
  selectBoardByName: (name: string) => {
    const b = useStore.getState().workspace.boards.find((x) => x.name.includes(name));
    if (b) useStore.getState().selectBoard(b.id);
    return b?.id ?? null;
  },
  setCamera: (c: { scale?: number; panX?: number; panY?: number }) => useStore.getState().setCamera(c),
  /** Frame the current board in the given canvas pixel size (defaults to the window). */
  fitBoard: (pxW?: number, pxH?: number) => {
    const st = useStore.getState();
    const b = st.workspace.boards.find((x) => x.id === st.currentBoardId);
    if (!b) return;
    const w = (pxW ?? window.innerWidth) - 380; // side panels
    const h = (pxH ?? window.innerHeight) - 120; // toolbar + hint
    const scale = Math.max(6, Math.min(90, Math.floor(Math.min(w / (b.cols + 4), h / (b.rows + 4)))));
    st.setCamera({ scale, panX: scale * 2.5, panY: scale * 2.5 });
  },
  /** Design-rule issues for a board (defaults to the current one). */
  issues: (boardId?: string) => {
    const st = useStore.getState();
    const ws = st.workspace;
    const b = ws.boards.find((x) => x.id === (boardId ?? st.currentBoardId));
    return b ? analyze(b, ws.library, ws.settings.pitchMm || 2.54).issues : [];
  },
};

// On startup, auto-load EVERY bundled design listed in public/designs/index.json
// so all boards show up in the toolbar menu without the user hunting for a file.
// Import-once: a design file is only auto-imported the first time it is seen
// (tracked in workspace.loadedDesigns), so deleting one of its boards sticks and
// it isn't resurrected on the next launch. Merge-by-id keeps it idempotent.
// ?design=<name|file> additionally selects that design's first board.
// ?fresh=1 clears storage first, so a fresh start re-imports the whole set.
async function autoLoadDesigns() {
  const explicit = new URLSearchParams(location.search).get('design');
  const explicitFile = explicit ? (explicit.endsWith('.json') ? explicit : `${explicit}.json`) : null;
  let index;
  try { index = await fetchDesignIndex(); } catch { return; }
  for (const entry of index) {
    const seen = (useStore.getState().workspace.loadedDesigns ?? []).includes(entry.file);
    if (seen && entry.file !== explicitFile) continue;   // already imported once
    try {
      const res = useStore.getState().importData(await fetchDesign(entry.file), entry.file);
      if (!res.ok) console.error('perfEdit: design import errors', entry.file, res.errors);
    } catch (e) {
      console.error('perfEdit: failed to load design', entry.file, e);
    }
  }
  // Bring the explicitly-requested design's first board to the foreground.
  if (explicitFile) {
    try {
      const res = useStore.getState().importData(await fetchDesign(explicitFile), explicitFile);
      if (res.ok && res.boardIds[0]) useStore.getState().selectBoard(res.boardIds[0]);
    } catch { /* already reported above */ }
  }
}
autoLoadDesigns();

createRoot(document.getElementById('root')!).render(<App />);
