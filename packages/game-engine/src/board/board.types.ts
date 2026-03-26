export interface Coordinate {
  row: number;
  column: number;
}

export interface BoardCell extends Coordinate {
  hasMine: boolean;
  adjacentMines: number;
  isRevealed: boolean;
  claimedByPlayerId: string | null;
}

export interface BoardState {
  rows: number;
  columns: number;
  mineCount: number;
  cells: BoardCell[][];
}

