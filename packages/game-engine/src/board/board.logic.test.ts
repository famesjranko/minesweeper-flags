import { describe, expect, it } from "vitest";
import { createBoard, createBoardFromMines, getBombCoordinates, revealBombArea } from "../index.js";

describe("bomb footprint", () => {
  it("keeps the top-left corner blast at a full 5x5 size", () => {
    const board = createBoard(1, { rows: 16, columns: 16, mineCount: 0 });
    const coordinates = getBombCoordinates(board, 0, 0);

    expect(coordinates).toHaveLength(25);
    expect(coordinates[0]).toEqual({ row: 0, column: 0 });
    expect(coordinates.at(-1)).toEqual({ row: 4, column: 4 });
  });

  it("keeps the bottom-right corner blast at a full 5x5 size", () => {
    const board = createBoard(1, { rows: 16, columns: 16, mineCount: 0 });
    const coordinates = getBombCoordinates(board, 15, 15);

    expect(coordinates).toHaveLength(25);
    expect(coordinates[0]).toEqual({ row: 11, column: 11 });
    expect(coordinates.at(-1)).toEqual({ row: 15, column: 15 });
  });

  it("reveals a full corner footprint instead of clipping it", () => {
    const board = createBoard(1, { rows: 16, columns: 16, mineCount: 0 });
    const resolution = revealBombArea(board, 0, 0);

    expect(resolution.revealedCount).toBe(25);
    expect(resolution.claimedMineCoordinates).toHaveLength(0);
  });
});

describe("board from mine positions", () => {
  it("places mines exactly where given and counts each clue", () => {
    // Given two mines in the top-left corner of a 4×4 board
    const mines = [
      { row: 0, column: 0 },
      { row: 1, column: 1 }
    ];

    // When a board is built from those positions
    const board = createBoardFromMines(mines, { rows: 4, columns: 4 });

    // Then only those cells hold mines
    expect(
      board.cells.flat().flatMap((cell) => (cell.hasMine ? [[cell.row, cell.column]] : []))
    ).toEqual([
      [0, 0],
      [1, 1]
    ]);

    // And each clue counts the mines around it
    expect(board.cells.map((row) => row.map((cell) => cell.adjacentMines))).toEqual([
      [0, 2, 1, 0],
      [2, 0, 1, 0],
      [1, 1, 1, 0],
      [0, 0, 0, 0]
    ]);
    expect(board.mineCount).toBe(2);
  });

  it("rejects mines outside the board or listed twice", () => {
    // Given one mine outside a 4×4 board and one mine listed twice
    const outside = [{ row: 4, column: 0 }];
    const repeated = [
      { row: 1, column: 1 },
      { row: 1, column: 1 }
    ];

    // When boards are built from them
    const buildOutside = () => createBoardFromMines(outside, { rows: 4, columns: 4 });
    const buildRepeated = () => createBoardFromMines(repeated, { rows: 4, columns: 4 });

    // Then both are refused
    expect(buildOutside).toThrow("outside the board");
    expect(buildRepeated).toThrow("more than once");
  });
});
