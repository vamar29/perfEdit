import { Workspace, ModuleDefinition, Board } from '../domain/types';
import { uid } from '../util';

const KEY = 'perfEdit.workspace.v1';

export function loadWorkspace(): Workspace | null {
  try {
    // ?fresh=1 gives a deterministic empty workspace (used by agents/tests).
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('fresh') === '1') {
      localStorage.removeItem(KEY);
      return null;
    }
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const ws = JSON.parse(s);
    if (!ws || !Array.isArray(ws.boards)) return null;
    return ws as Workspace;
  } catch {
    return null;
  }
}

export function saveWorkspace(ws: Workspace) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws));
  } catch (e) {
    console.warn('perfEdit: save failed', e);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSave(ws: Workspace) {
  clearTimeout(timer);
  timer = setTimeout(() => saveWorkspace(ws), 500);
}

export function makeDefaultWorkspace(): Workspace {
  const t = Date.now();
  const dip: ModuleDefinition = {
    id: uid(), name: 'DIP-8', cols: 4, rows: 3, designatorPrefix: 'U', color: '#3b82f6',
    createdAt: t, updatedAt: t,
    pins: [
      { id: uid(), col: 0, row: 0, type: 'passive', name: '1' },
      { id: uid(), col: 1, row: 0, type: 'passive', name: '2' },
      { id: uid(), col: 2, row: 0, type: 'passive', name: '3' },
      { id: uid(), col: 3, row: 0, type: 'ground', name: '4' },
      { id: uid(), col: 3, row: 2, type: 'passive', name: '5' },
      { id: uid(), col: 2, row: 2, type: 'passive', name: '6' },
      { id: uid(), col: 1, row: 2, type: 'passive', name: '7' },
      { id: uid(), col: 0, row: 2, type: 'power', name: '8' },
    ],
  };
  const hdr: ModuleDefinition = {
    id: uid(), name: '2-pin Header', cols: 2, rows: 1, designatorPrefix: 'J', color: '#10b981',
    createdAt: t, updatedAt: t,
    pins: [
      { id: uid(), col: 0, row: 0, type: 'passive', name: '1' },
      { id: uid(), col: 1, row: 0, type: 'passive', name: '2' },
    ],
  };
  const board: Board = {
    id: uid(), name: 'Board 1', type: 'perfboard', cols: 30, rows: 20, activeSide: 'top',
    modules: [], tracks: [], io: [], annotations: [], nets: [], createdAt: t, updatedAt: t,
  };
  return { schemaVersion: 1, library: [dip, hdr], boards: [board], settings: { pitchMm: 2.54, defaultBoardType: 'perfboard' }, loadedDesigns: [] };
}
