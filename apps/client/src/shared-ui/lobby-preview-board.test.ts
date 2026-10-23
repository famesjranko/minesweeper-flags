import { expect, it } from "vitest";
import { createCompactLobbyPreviewBoard, createLobbyPreviewBoard } from "./lobby-preview-board.js";

const adjacentMineCount = (
  cells: ReturnType<typeof createLobbyPreviewBoard>["cells"],
  row: number,
  column: number
) => {
  let count = 0;
  for (let adjacentRow = row - 1; adjacentRow <= row + 1; adjacentRow += 1) {
    for (let adjacentColumn = column - 1; adjacentColumn <= column + 1; adjacentColumn += 1) {
      if (adjacentRow !== row || adjacentColumn !== column) {
        count += Number(Boolean(cells[adjacentRow]?.[adjacentColumn]?.hasMine));
      }
    }
  }
  return count;
};

it("creates distinct reachable partial boards with correct claims and clues", () => {
  // Given two fixed engine seeds
  const first = createLobbyPreviewBoard(19);
  const second = createLobbyPreviewBoard(91);
  const firstCells = first.cells.flat();

  // When their engine-derived partial positions are inspected
  const firstMineLayout = firstCells.map((cell) => cell.hasMine).join("");
  const secondMineLayout = second.cells
    .flat()
    .map((cell) => cell.hasMine)
    .join("");

  // Then every displayed fact agrees with its independent board calculation
  expect(firstCells.filter((cell) => cell.hasMine)).toHaveLength(51);
  expect(firstMineLayout).not.toBe(secondMineLayout);
  expect(firstCells.filter((cell) => cell.claimedByPlayerId)).not.toHaveLength(0);
  expect(firstCells.filter((cell) => cell.claimedByPlayerId).every((cell) => cell.hasMine)).toBe(
    true
  );
  expect(firstCells.filter((cell) => cell.isRevealed).every((cell) => !cell.hasMine)).toBe(true);
  for (const cell of firstCells.filter((cell) => !cell.hasMine)) {
    expect(cell.adjacentMines).toBe(adjacentMineCount(first.cells, cell.row, cell.column));
  }
});

it("spreads seeded previews into varied clusters with both players represented", () => {
  // Given representative deterministic seeds
  const previews = [19, 91, 42].map(createLobbyPreviewBoard);

  // When the displayed cells are grouped into board quadrants
  for (const preview of previews) {
    const cells = preview.cells.flat();
    const revealed = cells.filter((cell) => cell.isRevealed);
    const revealedQuadrants = new Set(
      revealed.map(
        (cell) => `${cell.row < 8 ? "top" : "bottom"}-${cell.column < 8 ? "left" : "right"}`
      )
    );
    const claimants = new Set(
      cells.flatMap((cell) => (cell.claimedByPlayerId ? [cell.claimedByPlayerId] : []))
    );

    // Then the preview has spread-out numbered and blank areas, plus both flag colours
    expect(revealedQuadrants.size).toBe(4);
    expect(revealed.some((cell) => cell.adjacentMines === 0)).toBe(true);
    expect(revealed.some((cell) => cell.adjacentMines > 0)).toBe(true);
    expect(claimants).toEqual(new Set(["blue", "red"]));
    expect(cells.filter((cell) => !cell.isRevealed && !cell.claimedByPlayerId)).not.toHaveLength(0);
  }
});

it("creates legal compact 8×8 previews with a centred opening and three flags each", () => {
  // Given many deterministic seeds for the phone thumbnail
  const seeds = Array.from({ length: 200 }, (_, index) => index + 1);

  for (const seed of seeds) {
    // When a compact preview is generated
    const preview = createCompactLobbyPreviewBoard(seed);
    const cells = preview.cells.flat();
    const revealed = cells.filter((cell) => cell.isRevealed);
    const claimed = cells.filter((cell) => cell.claimedByPlayerId);

    // Then it is an 8×8 board whose claims, reveals, and clues agree with its mines
    expect(preview.cells).toHaveLength(8);
    expect(preview.cells.every((row) => row.length === 8)).toBe(true);
    expect(claimed.every((cell) => cell.hasMine)).toBe(true);
    expect(revealed.every((cell) => !cell.hasMine)).toBe(true);
    for (const cell of cells.filter((cell) => !cell.hasMine)) {
      expect(cell.adjacentMines).toBe(adjacentMineCount(preview.cells, cell.row, cell.column));
    }

    // And it shows a blank opening framed by hidden cells, with about half the board in play
    const blank = revealed.filter((cell) => cell.adjacentMines === 0);
    expect(blank.length).toBeGreaterThanOrEqual(5);
    expect(blank.every((cell) => [cell.row, cell.column].every((at) => at >= 2 && at <= 5))).toBe(
      true
    );
    expect(revealed.length).toBeGreaterThanOrEqual(20);
    expect(revealed.length).toBeLessThanOrEqual(40);

    // And each player has claimed three flags
    expect(claimed.filter((cell) => cell.claimedByPlayerId === "blue")).toHaveLength(3);
    expect(claimed.filter((cell) => cell.claimedByPlayerId === "red")).toHaveLength(3);
  }
});
