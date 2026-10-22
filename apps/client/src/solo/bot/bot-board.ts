import type { MatchStateDto } from "@minesweeper-flags/shared";

export type Fact = "unknown" | "safe" | "mine";

/** Board dimensions and the neighbours of each cell, indexed by `row * columns + column`. */
export interface BoardShape {
  rows: number;
  columns: number;
  size: number;
  neighbors: readonly (readonly number[])[];
}

/** A flat, read-once copy of the public board. */
export interface BoardView extends BoardShape {
  hidden: boolean[];
  claimed: boolean[];
  /** The clue of a revealed cell, or -1 when the cell shows no clue. */
  clues: number[];
  /** Revealed cells with at least one hidden neighbour: the only clues that can still teach anything. */
  clueCells: number[];
  mineCount: number;
}

export const rowOf = (shape: BoardShape, cell: number): number => Math.floor(cell / shape.columns);
export const columnOf = (shape: BoardShape, cell: number): number => cell % shape.columns;

export const distance = (
  shape: BoardShape,
  cell: number,
  focus: { row: number; column: number }
): number =>
  Math.max(
    Math.abs(rowOf(shape, cell) - focus.row),
    Math.abs(columnOf(shape, cell) - focus.column)
  );

export const cellDistance = (shape: BoardShape, a: number, b: number): number =>
  distance(shape, a, { row: rowOf(shape, b), column: columnOf(shape, b) });

const neighborsOf = (rows: number, columns: number, cell: number): number[] => {
  const neighbors: number[] = [];
  const row = Math.floor(cell / columns);
  const column = cell % columns;
  for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r += 1) {
    for (let c = Math.max(0, column - 1); c <= Math.min(columns - 1, column + 1); c += 1) {
      if (r !== row || c !== column) {
        neighbors.push(r * columns + c);
      }
    }
  }
  return neighbors;
};

// Games keep one board size, so caching the last shape avoids rebuilding the
// neighbour table on every decision without holding on to every size seen.
let lastShape: BoardShape | null = null;

const shapeOf = (rows: number, columns: number): BoardShape => {
  if (lastShape?.rows !== rows || lastShape.columns !== columns) {
    const size = rows * columns;
    lastShape = {
      rows,
      columns,
      size,
      neighbors: Array.from({ length: size }, (_, cell) => neighborsOf(rows, columns, cell))
    };
  }
  return lastShape;
};

/** Reads a board whose size and cell positions the caller has already validated. */
export const readBoard = (match: MatchStateDto): BoardView => {
  const shape = shapeOf(match.board.rows, match.board.columns);
  const view: BoardView = {
    ...shape,
    hidden: new Array<boolean>(shape.size).fill(false),
    claimed: new Array<boolean>(shape.size).fill(false),
    clues: new Array<number>(shape.size).fill(-1),
    clueCells: [],
    mineCount: match.board.mineCount
  };
  match.board.cells.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const index = rowIndex * shape.columns + columnIndex;
      view.hidden[index] = cell.status === "hidden";
      view.claimed[index] = cell.status === "claimed";
      if (cell.status === "revealed") {
        view.clues[index] = cell.adjacentMines ?? -1;
      }
    });
  });
  view.clueCells = view.clues.flatMap((clue, cell) =>
    clue >= 0 && shape.neighbors[cell]!.some((neighbor) => view.hidden[neighbor]) ? [cell] : []
  );
  return view;
};

/** A clue with no hidden neighbour is settled: it must equal its claimed neighbours. */
export const settledCluesHold = (board: BoardView): boolean =>
  board.clues.every(
    (clue, cell) =>
      clue < 0 ||
      board.neighbors[cell]!.some((neighbor) => board.hidden[neighbor]) ||
      board.neighbors[cell]!.filter((neighbor) => board.claimed[neighbor]).length === clue
  );

export const hasRevealedNeighbor = (board: BoardView, cell: number): boolean =>
  board.neighbors[cell]!.some((neighbor) => board.clues[neighbor]! >= 0);

/** One revealed clue with the mines it still needs among its unresolved neighbours. */
export interface ClueState {
  cell: number;
  remaining: number;
  unknowns: number[];
}

export const isUnknown = (board: BoardView, facts: Fact[], cell: number): boolean =>
  board.hidden[cell]! && facts[cell] === "unknown";

export const summarise = (board: BoardView, facts: Fact[], cell: number): ClueState => {
  let knownMines = 0;
  const unknowns: number[] = [];
  for (const neighbor of board.neighbors[cell]!) {
    if (facts[neighbor] === "mine") {
      knownMines += 1;
    } else if (isUnknown(board, facts, neighbor)) {
      unknowns.push(neighbor);
    }
  }
  return { cell, remaining: board.clues[cell]! - knownMines, unknowns };
};

export const clueStates = (board: BoardView, facts: Fact[]): ClueState[] =>
  board.clueCells.map((cell) => summarise(board, facts, cell));
