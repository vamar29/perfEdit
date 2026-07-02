// Workspace import/export. The JSON format is the persisted Workspace shape
// (or any subset with `library` and/or `boards`). Import MERGES BY ID —
// entries whose id already exists are replaced, new ids are appended — so
// re-importing an edited design file is idempotent. This is the primary way
// automated agents feed designs into the app (see AGENTS.md).

import { Workspace, Board, ModuleDefinition } from '../domain/types';
import { PIN_TYPES } from '../util';

export interface ImportPayload {
  schemaVersion?: number;
  library?: ModuleDefinition[];
  boards?: Board[];
}

export interface ImportResult {
  ok: boolean;
  errors: string[];
  libraryIds: string[];
  boardIds: string[];
}

const isInt = (v: any) => Number.isInteger(v);
const isNum = (v: any) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: any) => typeof v === 'string' && v.length > 0;
const ROTS = [0, 90, 180, 270];

/** Structural validation with actionable messages (agents read these). */
export function validatePayload(data: any, existingLib: ModuleDefinition[]): string[] {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < 40) errors.push(m); };
  if (!data || typeof data !== 'object') return ['Payload is not an object'];
  if (data.library == null && data.boards == null) return ['Payload has neither "library" nor "boards"'];

  const libIds = new Set(existingLib.map((d) => d.id));
  if (data.library != null) {
    if (!Array.isArray(data.library)) return ['"library" must be an array of module definitions'];
    for (const [i, d] of (data.library as any[]).entries()) {
      const at = `library[${i}]${d?.name ? ` ("${d.name}")` : ''}`;
      if (!isStr(d?.id)) { err(`${at}: missing string "id"`); continue; }
      libIds.add(d.id);
      if (!isStr(d.name)) err(`${at}: missing "name"`);
      if (!isInt(d.cols) || d.cols < 1 || !isInt(d.rows) || d.rows < 1) err(`${at}: "cols"/"rows" must be integers >= 1`);
      if (!isStr(d.designatorPrefix)) err(`${at}: missing "designatorPrefix"`);
      if (!isStr(d.color)) err(`${at}: missing "color"`);
      if (!Array.isArray(d.pins)) { err(`${at}: "pins" must be an array`); continue; }
      for (const [j, p] of (d.pins as any[]).entries()) {
        const pat = `${at}.pins[${j}]`;
        if (!isStr(p?.id)) err(`${pat}: missing string "id"`);
        if (!isInt(p?.col) || !isInt(p?.row) || p.col < 0 || p.row < 0 || p.col >= d.cols || p.row >= d.rows)
          err(`${pat}: col/row must be integers inside the ${d.cols}x${d.rows} pin grid`);
        if (!PIN_TYPES.includes(p?.type)) err(`${pat}: type must be one of ${PIN_TYPES.join('|')}`);
        if (typeof p?.name !== 'string') err(`${pat}: missing "name"`);
      }
      if (d.bodyMm != null) {
        const b = d.bodyMm;
        if (!isNum(b.w) || !isNum(b.h) || b.w <= 0 || b.h <= 0 || !isNum(b.dx) || !isNum(b.dy))
          err(`${at}: bodyMm needs numeric w>0, h>0, dx, dy (mm, relative to hole (0,0) center)`);
      }
    }
  }

  if (data.boards != null) {
    if (!Array.isArray(data.boards)) return [...errors, '"boards" must be an array'];
    for (const [i, b] of (data.boards as any[]).entries()) {
      const at = `boards[${i}]${b?.name ? ` ("${b.name}")` : ''}`;
      if (!isStr(b?.id)) { err(`${at}: missing string "id"`); continue; }
      if (!isStr(b.name)) err(`${at}: missing "name"`);
      if (!isInt(b.cols) || !isInt(b.rows) || b.cols < 2 || b.rows < 2) err(`${at}: "cols"/"rows" must be integers >= 2`);
      const netIds = new Set<string>((b.nets ?? []).map((n: any) => n?.id));
      for (const k of ['modules', 'tracks', 'io', 'annotations', 'nets'] as const)
        if (b[k] != null && !Array.isArray(b[k])) err(`${at}: "${k}" must be an array`);
      for (const [j, m] of ((b.modules ?? []) as any[]).entries()) {
        const mat = `${at}.modules[${j}]${m?.designator ? ` (${m.designator})` : ''}`;
        if (!isStr(m?.id)) err(`${mat}: missing string "id"`);
        if (!isStr(m?.defId) || !libIds.has(m.defId)) err(`${mat}: defId "${m?.defId}" not found in library (payload + existing)`);
        if (!isInt(m?.col) || !isInt(m?.row)) err(`${mat}: col/row must be integers`);
        if (!ROTS.includes(m?.rotation)) err(`${mat}: rotation must be 0|90|180|270`);
        if (m?.side !== 'top' && m?.side !== 'bottom') err(`${mat}: side must be "top"|"bottom"`);
        if (!isStr(m?.designator)) err(`${mat}: missing "designator"`);
      }
      for (const [j, t] of ((b.tracks ?? []) as any[]).entries()) {
        const tat = `${at}.tracks[${j}]`;
        if (!isStr(t?.id)) err(`${tat}: missing string "id"`);
        if (t?.side !== 'top' && t?.side !== 'bottom') err(`${tat}: side must be "top"|"bottom"`);
        if (!Array.isArray(t?.points) || t.points.length < 2) err(`${tat}: "points" needs >= 2 holes`);
        else for (const p of t.points) if (!isInt(p?.col) || !isInt(p?.row)) { err(`${tat}: points must be integer {col,row}`); break; }
        if (t?.netId != null && !netIds.has(t.netId)) err(`${tat}: netId "${t.netId}" not in this board's nets`);
      }
      for (const [j, n] of ((b.nets ?? []) as any[]).entries()) {
        if (!isStr(n?.id) || !isStr(n?.name) || !isStr(n?.color) || !['signal', 'power', 'ground'].includes(n?.kind))
          err(`${at}.nets[${j}]: needs id, name, color, kind signal|power|ground`);
      }
    }
  }
  return errors;
}

/** Merge a validated payload into the workspace (replace-by-id, append new). */
export function mergePayload(ws: Workspace, data: ImportPayload): { libraryIds: string[]; boardIds: string[] } {
  const libraryIds: string[] = [];
  const boardIds: string[] = [];
  const t = Date.now();
  for (const d of data.library ?? []) {
    libraryIds.push(d.id);
    const i = ws.library.findIndex((x) => x.id === d.id);
    const withTimes = { createdAt: t, updatedAt: t, ...d };
    if (i >= 0) ws.library[i] = withTimes; else ws.library.push(withTimes);
  }
  for (const b of data.boards ?? []) {
    boardIds.push(b.id);
    const full: Board = {
      activeSide: 'top', modules: [], tracks: [], io: [], annotations: [], nets: [],
      createdAt: t, updatedAt: t, type: ws.settings.defaultBoardType,
      ...b,
    };
    const i = ws.boards.findIndex((x) => x.id === b.id);
    if (i >= 0) ws.boards[i] = full; else ws.boards.push(full);
  }
  return { libraryIds, boardIds };
}

export function exportWorkspaceJson(ws: Workspace): string {
  return JSON.stringify(ws, null, 2);
}

export function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Bundled designs live in public/designs; index.json lists them. */
export interface DesignEntry { file: string; name: string; description?: string }

export async function fetchDesignIndex(): Promise<DesignEntry[]> {
  const r = await fetch('designs/index.json', { cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

export async function fetchDesign(file: string): Promise<ImportPayload> {
  const r = await fetch(`designs/${file}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`designs/${file}: HTTP ${r.status}`);
  return r.json();
}
