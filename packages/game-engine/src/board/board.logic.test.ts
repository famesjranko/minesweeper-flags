import { describe, expect, it } from "vitest";
import { createBoard, getBombCoordinates, revealBombArea } from "../index.js";

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
