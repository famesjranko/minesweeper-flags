import { BOMB_RADIUS, BOARD_COLUMNS, BOARD_ROWS, TOTAL_MINES } from "./board.constants.js";
import type { BoardCell, BoardState, Coordinate } from "./board.types.js";

export interface BoardConfig {
  rows?: number;
  columns?: number;
  mineCount?: number;
}

const ADJACENT_OFFSETS = [-1, 0, 1];

const hashSeed = (seed: number | string): number => {
  const value = String(seed);
  let hash = 1779033703 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return hash >>> 0;
};

const createRng = (seed: number | string) => {
  let state = hashSeed(seed);

  return () => {
    state += 0x6d2b79f5;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const createEmptyBoard = (rows: number, columns: number): BoardCell[][] =>
  Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => ({
      row,
      column,
      hasMine: false,
      adjacentMines: 0,
      isRevealed: false,
      claimedByPlayerId: null
    }))
  );

const getAdjacentCoordinates = (
  row: number,
  column: number,
  rows: number,
  columns: number
): Coordinate[] => {
  const coordinates: Coordinate[] = [];

  for (const rowOffset of ADJACENT_OFFSETS) {
    for (const columnOffset of ADJACENT_OFFSETS) {
      if (rowOffset === 0 && columnOffset === 0) {
        continue;
      }

      const nextRow = row + rowOffset;
      const nextColumn = column + columnOffset;

      if (nextRow >= 0 && nextRow < rows && nextColumn >= 0 && nextColumn < columns) {
        coordinates.push({ row: nextRow, column: nextColumn });
      }
    }
  }

  return coordinates;
};

export const cloneBoard = (board: BoardState): BoardState => ({
  ...board,
  cells: board.cells.map((row) => row.map((cell) => ({ ...cell })))
});

export const createBoard = (
  seed: number | string,
  config: BoardConfig = {}
): BoardState => {
  const rows = config.rows ?? BOARD_ROWS;
  const columns = config.columns ?? BOARD_COLUMNS;
  const mineCount = config.mineCount ?? TOTAL_MINES;

  if (mineCount >= rows * columns) {
    throw new Error("Mine count must be lower than the number of cells.");
  }

  const rng = createRng(seed);
  const board = createEmptyBoard(rows, columns);
  const positions = Array.from({ length: rows * columns }, (_, index) => index);

  for (let index = positions.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [positions[index], positions[swapIndex]] = [positions[swapIndex]!, positions[index]!];
  }

  for (const position of positions.slice(0, mineCount)) {
    const row = Math.floor(position / columns);
    const column = position % columns;
    board[row]![column]!.hasMine = true;
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = board[row]![column]!;

      if (cell.hasMine) {
        continue;
      }

      cell.adjacentMines = getAdjacentCoordinates(row, column, rows, columns).filter(
        ({ row: adjacentRow, column: adjacentColumn }) =>
          board[adjacentRow]![adjacentColumn]!.hasMine
      ).length;
    }
  }

  return { rows, columns, mineCount, cells: board };
};

export const isWithinBoard = (board: BoardState, row: number, column: number): boolean =>
  row >= 0 && row < board.rows && column >= 0 && column < board.columns;

export const getCell = (board: BoardState, row: number, column: number): BoardCell => {
  if (!isWithinBoard(board, row, column)) {
    throw new Error(`Cell ${row},${column} is outside the board.`);
  }

  return board.cells[row]![column]!;
};

export const revealConnectedSafeCells = (
  board: BoardState,
  startRow: number,
  startColumn: number
): { board: BoardState; revealedCount: number } => {
  const nextBoard = cloneBoard(board);
  const startCell = getCell(nextBoard, startRow, startColumn);

  if (startCell.hasMine || startCell.isRevealed || startCell.claimedByPlayerId) {
    return { board: nextBoard, revealedCount: 0 };
  }

  const queue: Coordinate[] = [{ row: startRow, column: startColumn }];
  const visited = new Set<string>();
  let revealedCount = 0;

  while (queue.length > 0) {
    const coordinate = queue.shift()!;
    const key = `${coordinate.row}:${coordinate.column}`;

    if (visited.has(key)) {
      continue;
    }

    visited.add(key);
    const cell = getCell(nextBoard, coordinate.row, coordinate.column);

    if (cell.hasMine || cell.isRevealed || cell.claimedByPlayerId) {
      continue;
    }

    cell.isRevealed = true;
    revealedCount += 1;

    if (cell.adjacentMines !== 0) {
      continue;
    }

    queue.push(
      ...getAdjacentCoordinates(coordinate.row, coordinate.column, nextBoard.rows, nextBoard.columns)
    );
  }

  return { board: nextBoard, revealedCount };
};

export const revealBombArea = (
  board: BoardState,
  row: number,
  column: number
): { board: BoardState; revealedCount: number; claimedMineCoordinates: Coordinate[] } => {
  const nextBoard = cloneBoard(board);
  const coordinates = getBombCoordinates(nextBoard, row, column);
  const claimedMineCoordinates: Coordinate[] = [];
  let revealedCount = 0;

  for (const coordinate of coordinates) {
    const cell = getCell(nextBoard, coordinate.row, coordinate.column);

    if (cell.claimedByPlayerId || cell.isRevealed) {
      continue;
    }

    if (cell.hasMine) {
      claimedMineCoordinates.push(coordinate);
      continue;
    }

    cell.isRevealed = true;
    revealedCount += 1;
  }

  return { board: nextBoard, revealedCount, claimedMineCoordinates };
};

export const getBombCoordinates = (
  board: BoardState,
  row: number,
  column: number,
  radius = BOMB_RADIUS
): Coordinate[] => {
  const coordinates: Coordinate[] = [];

  for (let nextRow = row - radius; nextRow <= row + radius; nextRow += 1) {
    for (let nextColumn = column - radius; nextColumn <= column + radius; nextColumn += 1) {
      if (isWithinBoard(board, nextRow, nextColumn)) {
        coordinates.push({ row: nextRow, column: nextColumn });
      }
    }
  }

  return coordinates;
};

export const countClaimedMines = (board: BoardState): number =>
  board.cells.flat().filter((cell) => cell.hasMine && cell.claimedByPlayerId).length;

export const countRemainingMines = (board: BoardState): number => board.mineCount - countClaimedMines(board);

export { BOARD_COLUMNS, BOARD_ROWS, BOMB_RADIUS, TOTAL_MINES };

