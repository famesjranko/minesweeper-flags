import type { BoardState, Coordinate } from "@minesweeper-flags/game-engine";
import {
  createBoardFromMines,
  createMatchState,
  resolveAction
} from "@minesweeper-flags/game-engine";

export type LobbyPreviewCell = BoardState["cells"][number][number];

export type LobbyPreviewSize = "full" | "compact";

export interface LobbyPreviewBoard {
  cells: LobbyPreviewCell[][];
  seed: number;
}

const players = [
  { playerId: "blue", displayName: "Blue" },
  { playerId: "red", displayName: "Red" }
] as const;

type PreviewCell = BoardState["cells"][number][number];

interface PreviewAnchor {
  row: number;
  column: number;
}

interface SafeMoveOptions {
  anchor: PreviewAnchor;
  preferBlank: boolean;
  random: () => number;
  updatedAt: number;
}

const createSeededRandom = (seed: number) => {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const distanceFrom = (cell: PreviewCell, anchor: PreviewAnchor) =>
  Math.abs(cell.row - anchor.row) + Math.abs(cell.column - anchor.column);

const createAnchors = (board: BoardState, random: () => number): PreviewAnchor[] => {
  const rowMidpoint = Math.floor(board.rows / 2);
  const columnMidpoint = Math.floor(board.columns / 2);
  const quadrants = [
    [0, rowMidpoint, 0, columnMidpoint],
    [0, rowMidpoint, columnMidpoint, board.columns],
    [rowMidpoint, board.rows, 0, columnMidpoint],
    [rowMidpoint, board.rows, columnMidpoint, board.columns]
  ] as const;

  return quadrants
    .map(([rowStart, rowEnd, columnStart, columnEnd]) => ({
      row: rowStart + Math.floor(random() * (rowEnd - rowStart)),
      column: columnStart + Math.floor(random() * (columnEnd - columnStart)),
      order: random()
    }))
    .sort((left, right) => left.order - right.order)
    .map(({ row, column }) => ({ row, column }));
};

const orderCandidates = (
  board: BoardState,
  anchor: PreviewAnchor,
  hasMine: boolean,
  random: () => number
) =>
  board.cells
    .flat()
    .filter((cell) => !cell.isRevealed && !cell.claimedByPlayerId && cell.hasMine === hasMine)
    .map((cell) => ({ cell, score: distanceFrom(cell, anchor) + random() * 2 }))
    .sort((left, right) => left.score - right.score)
    .map(({ cell }) => cell);

const selectSafeMove = (
  state: ReturnType<typeof createMatchState>,
  { anchor, preferBlank, random, updatedAt }: SafeMoveOptions
) => {
  const candidates = orderCandidates(state.board, anchor, false, random);
  const preferredCandidates = candidates.filter(
    (cell) => (cell.adjacentMines === 0) === preferBlank
  );
  const fallbackCandidates = candidates.filter(
    (cell) => (cell.adjacentMines === 0) !== preferBlank
  );

  // Keep blank areas small, then fall back to numbered cells rather than leaving a preview empty.
  for (const cell of [...preferredCandidates.slice(0, 24), ...fallbackCandidates.slice(0, 24)]) {
    const resolution = resolveAction(
      state,
      {
        type: "select",
        playerId: state.currentTurnPlayerId!,
        row: cell.row,
        column: cell.column
      },
      updatedAt
    );

    if (
      resolution.ok &&
      resolution.state.phase === "live" &&
      resolution.action.revealedCount <= 28
    ) {
      return resolution;
    }
  }
};

const createPreviewMatch = (seed: number) =>
  createMatchState({
    roomId: "lobby-preview",
    players: [...players],
    seed,
    createdAt: 0,
    startingPlayerId: "blue"
  });

/** Produces a genuine, short in-progress match from a reproducible engine seed. */
export const createLobbyPreviewBoard = (seed: number): LobbyPreviewBoard => {
  let state = createPreviewMatch(seed);

  const random = createSeededRandom(seed);
  const anchors = createAnchors(state.board, random);

  // Each anchored safe reveal changes turns, then the other player claims a nearby mine.
  // The engine still determines all reveals, claims, and whether the match remains live.
  for (let cluster = 0; cluster < 10 && state.phase === "live"; cluster += 1) {
    const anchor = anchors[cluster % anchors.length]!;
    const safeMove = selectSafeMove(state, {
      anchor,
      preferBlank: cluster < 3,
      random,
      updatedAt: cluster * 2 + 1
    });
    if (!safeMove?.ok) break;
    state = safeMove.state;

    const mine = orderCandidates(state.board, anchor, true, random)[0];
    if (!mine || !state.currentTurnPlayerId) continue;

    const mineMove = resolveAction(
      state,
      {
        type: "select",
        playerId: state.currentTurnPlayerId,
        row: mine.row,
        column: mine.column
      },
      cluster * 2 + 2
    );
    if (mineMove.ok) state = mineMove.state;
  }

  return { cells: state.board.cells, seed };
};

type PreviewMatch = ReturnType<typeof createMatchState>;

export interface PreviewPocket {
  /** The pocket grows outward from this cell. */
  center: Coordinate;
  /** Number of blank cells in the pocket; its clue border adds the rest. */
  blankCells: number;
}

export interface PreviewPlan {
  rows: number;
  columns: number;
  mineCount: number;
  /** Blank cells stay this many cells from every edge, so hidden cells frame each pocket. */
  margin: number;
  pockets: PreviewPocket[];
  flagsPerPlayer: number;
}

const neighbours = ({ row, column }: Coordinate, rows: number, columns: number) =>
  [-1, 0, 1].flatMap((rowOffset) =>
    [-1, 0, 1].flatMap((columnOffset) => {
      const next = { row: row + rowOffset, column: column + columnOffset };
      const inside = next.row >= 0 && next.row < rows && next.column >= 0 && next.column < columns;
      return inside && (rowOffset || columnOffset) ? [next] : [];
    })
  );

const keyOf = ({ row, column }: Coordinate) => `${row}:${column}`;

const pickRandom = <T>(items: readonly T[], random: () => number) =>
  items[Math.floor(random() * items.length)];

/** Grows a rounded, connected pocket by adding the nearest frontier cell with a little noise. */
const growPocket = (pocket: PreviewPocket, plan: PreviewPlan, random: () => number) => {
  const { margin, rows, columns } = plan;
  const inBounds = ({ row, column }: Coordinate) =>
    row >= margin && row < rows - margin && column >= margin && column < columns - margin;
  const cells = new Map([[keyOf(pocket.center), pocket.center]]);

  while (cells.size < pocket.blankCells) {
    const frontier = [...cells.values()]
      .flatMap((cell) => neighbours(cell, rows, columns))
      .filter((cell) => inBounds(cell) && !cells.has(keyOf(cell)));
    const next = frontier
      .map((cell) => ({
        cell,
        score:
          Math.hypot(cell.row - pocket.center.row, cell.column - pocket.center.column) +
          random() * 1.5
      }))
      .sort((left, right) => left.score - right.score)[0]?.cell;
    if (!next) break;
    cells.set(keyOf(next), next);
  }

  return [...cells.values()];
};

const isAdjacent = (left: Coordinate, right: Coordinate) =>
  Math.max(Math.abs(left.row - right.row), Math.abs(left.column - right.column)) === 1;

/**
 * Places mines so that one click in each pocket reveals exactly the pocket and its clue border.
 * No mine touches a blank cell, and every border cell that faces hidden cells gets a mine
 * beside it, which stops the engine's flood fill at the border.
 */
const placeMines = (blank: Coordinate[], plan: PreviewPlan, random: () => number) => {
  const { rows, columns } = plan;
  const indexOf = ({ row, column }: Coordinate) => row * columns + column;
  const reserved = new Set(blank.map(indexOf));
  const border = new Map<number, Coordinate>();
  for (const cell of blank.flatMap((entry) => neighbours(entry, rows, columns))) {
    if (!reserved.has(indexOf(cell))) border.set(indexOf(cell), cell);
  }
  for (const index of border.keys()) reserved.add(index);

  const mines = new Map<number, Coordinate>();
  const outside = (cell: Coordinate) =>
    neighbours(cell, rows, columns).filter((next) => !reserved.has(indexOf(next)));
  let open = [...border.values()].filter((cell) => outside(cell).length > 0);

  while (open.length > 0) {
    // Greedy cover: each mine settles as many open border cells as it can.
    const candidates = new Map(open.flatMap(outside).map((cell) => [indexOf(cell), cell]));
    const scored = [...candidates.values()].map((cell) => ({
      cell,
      covers: open.filter((edge) => isAdjacent(edge, cell)).length
    }));
    const best = Math.max(...scored.map(({ covers }) => covers));
    const mine = pickRandom(
      scored.filter(({ covers }) => covers === best),
      random
    )!.cell;
    mines.set(indexOf(mine), mine);
    open = open.filter((edge) => !isAdjacent(edge, mine));
  }

  // The cover may use more mines than planned; a decorative board can carry the extra few.
  const free = Array.from({ length: rows * columns }, (_, index) => ({
    row: Math.floor(index / columns),
    column: index % columns
  })).filter((cell) => !reserved.has(indexOf(cell)) && !mines.has(indexOf(cell)));
  while (mines.size < plan.mineCount && free.length > 0) {
    const [mine] = free.splice(Math.floor(random() * free.length), 1);
    mines.set(indexOf(mine!), mine!);
  }

  return [...mines.values()];
};

const play = (state: PreviewMatch, cell: Coordinate): PreviewMatch | undefined => {
  const resolution = resolveAction(
    state,
    { type: "select", playerId: state.currentTurnPlayerId!, ...cell },
    state.updatedAt + 1
  );
  return resolution.ok && resolution.state.phase === "live" ? resolution.state : undefined;
};

const touchesRevealed = (board: BoardState, cell: Coordinate) =>
  neighbours(cell, board.rows, board.columns).some(
    (next) => board.cells[next.row]![next.column]!.isRevealed
  );

/**
 * Claims edge mines for both players. A claim keeps the turn and a single clue reveal on the
 * edge passes it, so each player claims one or two mines before handing over.
 */
const claimEdgeFlags = (state: PreviewMatch, plan: PreviewPlan, random: () => number) => {
  const flagsOf = (match: PreviewMatch, playerId: string) =>
    match.board.cells.flat().filter((cell) => cell.claimedByPlayerId === playerId).length;
  const needsFlag = (match: PreviewMatch) =>
    players.some(({ playerId }) => flagsOf(match, playerId) < plan.flagsPerPlayer);
  const edgeCells = (match: PreviewMatch) =>
    match.board.cells
      .flat()
      .filter(
        (cell) => !cell.isRevealed && !cell.claimedByPlayerId && touchesRevealed(match.board, cell)
      );
  let current = state;

  for (let turn = 0; turn < plan.flagsPerPlayer * 4 && needsFlag(current); turn += 1) {
    const playerId = current.currentTurnPlayerId!;
    const owed = plan.flagsPerPlayer - flagsOf(current, playerId);
    for (let claim = Math.min(1 + Math.floor(random() * 2), owed); claim > 0; claim -= 1) {
      const mine = pickRandom(
        edgeCells(current).filter((cell) => cell.hasMine),
        random
      );
      current = (mine && play(current, mine)) || current;
    }

    const clue = pickRandom(
      edgeCells(current).filter((cell) => !cell.hasMine && cell.adjacentMines > 0),
      random
    );
    const passed = clue && play(current, clue);
    if (!passed) break;
    current = passed;
  }

  return current;
};

/** Builds a live match that matches a planned composition, then plays it through the engine. */
export const composeLobbyPreviewBoard = (seed: number, plan: PreviewPlan): LobbyPreviewBoard => {
  const random = createSeededRandom(seed);
  const pockets = plan.pockets.map((pocket) => growPocket(pocket, plan, random));
  const mines = placeMines(pockets.flat(), plan, random);
  let state: PreviewMatch = {
    ...createPreviewMatch(seed),
    board: createBoardFromMines(mines, plan)
  };

  for (const pocket of pockets) {
    state = play(state, pocket[0]!) ?? state;
  }

  return { cells: claimEdgeFlags(state, plan, random).board.cells, seed };
};

/** A single rounded opening near the middle of an 8×8 board, framed by hidden cells. */
export const createCompactLobbyPreviewBoard = (seed: number): LobbyPreviewBoard => {
  const random = createSeededRandom(seed ^ 0x9e3779b9);
  return composeLobbyPreviewBoard(seed, {
    rows: 8,
    columns: 8,
    mineCount: 13,
    margin: 2,
    pockets: [
      {
        center: { row: 3 + Math.floor(random() * 2), column: 3 + Math.floor(random() * 2) },
        blankCells: 6 + Math.floor(random() * 4)
      }
    ],
    flagsPerPlayer: 3
  });
};

const createDocumentSeed = (): number => {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  }
  return Math.floor(Math.random() * 0xffffffff);
};

const previewGenerators = {
  full: createLobbyPreviewBoard,
  compact: createCompactLobbyPreviewBoard
} satisfies Record<LobbyPreviewSize, (seed: number) => LobbyPreviewBoard>;

const cachedPreviews: Partial<Record<LobbyPreviewSize, LobbyPreviewBoard>> = {};

/** Keeps one board per size for this document, including React remounts and mode changes. */
export const getLobbyPreviewBoard = (size: LobbyPreviewSize): LobbyPreviewBoard =>
  (cachedPreviews[size] ??= previewGenerators[size](createDocumentSeed()));
