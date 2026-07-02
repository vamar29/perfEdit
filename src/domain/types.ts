// All geometry is stored in integer HOLE coordinates (col, row), origin top-left.
// Pitch (2.54mm) is a render constant, never stored. Flip is a render transform.

export type Id = string;
export interface Hole { col: number; row: number }
export type Rotation = 0 | 90 | 180 | 270;
export type Side = 'top' | 'bottom';
export type PinType =
  | 'input' | 'output' | 'power' | 'ground'
  | 'passive' | 'bidirectional' | 'no-connect';

export interface Pin {
  id: Id;
  col: number;            // relative to module origin, unrotated
  row: number;
  type: PinType;
  name: string;
  label?: string;
}

/**
 * Physical body outline in millimetres, relative to the CENTER of hole (0,0)
 * of the module's pin grid (unrotated). Most real modules are larger than the
 * grid their pins land on; this rectangle is what actually occupies the board.
 * dx/dy are usually negative (body extends up/left past pin 0,0).
 */
export interface BodyMm {
  w: number;              // body width, mm (along cols at rotation 0)
  h: number;              // body height, mm (along rows at rotation 0)
  dx: number;             // body left edge relative to hole (0,0) center, mm
  dy: number;             // body top edge relative to hole (0,0) center, mm
}

export interface ModuleDefinition {
  id: Id;
  name: string;
  cols: number;           // pin-grid bounding box, in holes
  rows: number;
  pins: Pin[];
  designatorPrefix: string;
  color: string;
  bodyMm?: BodyMm;        // physical outline; when absent the body hugs the pin grid
  mayOverhang?: boolean;  // edge connectors etc. — suppresses the board-edge overhang warning
  notes?: string;         // datasheet caveats, approximations, purchase info
  createdAt: number;
  updatedAt: number;
}

export type BoardType = 'perfboard' | 'pad-per-hole';
export type NetKind = 'signal' | 'power' | 'ground';

export interface PlacedModule {
  id: Id;
  defId: Id;
  col: number;            // origin (top-left) on the board
  row: number;
  rotation: Rotation;
  side: Side;             // modules live on 'top'
  designator: string;
  labelOverride?: string;
}

export interface Net { id: Id; name: string; color: string; kind: NetKind }

export interface Track {
  id: Id;
  side: Side;
  points: Hole[];         // ordered, hole-snapped polyline (>= 2 holes)
  netId?: Id;
  color?: string;
  label?: string;
  rail?: boolean;         // power/ground bus rail styling
}

export interface BoardIO {
  id: Id;
  kind: 'input' | 'output';
  name: string;
  col: number;
  row: number;
  netId?: Id;
  color?: string;
}

export interface Annotation {
  id: Id;
  text: string;
  col: number;
  row: number;
  side: Side | 'both';
  color?: string;
}

export interface Board {
  id: Id;
  name: string;
  type: BoardType;
  cols: number;
  rows: number;
  activeSide: Side;
  modules: PlacedModule[];
  tracks: Track[];
  io: BoardIO[];
  annotations: Annotation[];
  nets: Net[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings { pitchMm: number; defaultBoardType: BoardType }

export interface Workspace {
  schemaVersion: number;
  library: ModuleDefinition[];
  boards: Board[];
  settings: Settings;
  loadedDesigns?: string[];   // bundled-design files already auto-imported at startup (import-once)
}
