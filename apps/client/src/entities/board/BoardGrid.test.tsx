import type { MatchStateDto } from "@minesweeper-flags/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardGrid } from "./BoardGrid.js";

const match = {
  board: {
    rows: 2,
    columns: 2,
    mineCount: 1,
    cells: [0, 1].map((row) =>
      [0, 1].map((column) => ({
        row,
        column,
        status: "hidden" as const,
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  }
} as unknown as MatchStateDto;

const render = (lastMove?: Parameters<typeof BoardGrid>[0]["lastMove"]) =>
  renderToStaticMarkup(
    <BoardGrid
      match={match}
      canAct={false}
      bombArmed={false}
      playerTones={{}}
      {...(lastMove ? { lastMove } : {})}
      onSelectCell={() => {}}
    />
  );

describe("BoardGrid last-move marks", () => {
  it("adds is-last-move with the tone class to the marked cell only", () => {
    // Given one marked cell
    // When the board renders
    const html = render({
      cells: [{ row: 1, column: 0, tone: "red" }],
      areas: []
    });

    // Then exactly one cell carries the marker classes
    expect(html.match(/is-last-move/g)).toHaveLength(1);
    expect(html).toContain('class="board-cell status-hidden is-last-move last-move-red"');
    expect(html).toContain('title="Row 2, Column 1"');
  });

  it("renders no marker when nothing is marked", () => {
    // Given no marks
    // When the board renders
    // Then no marker class appears
    expect(render()).not.toContain("last-move");
  });

  it("renders an area outline sized to the bounds", () => {
    // Given a 2x2 area mark
    // When the board renders
    const html = render({
      cells: [],
      areas: [{ bounds: { minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1 }, tone: "blue" }]
    });

    // Then the overlay spans two cells
    expect(html).toContain('class="board-last-move-area last-move-blue"');
    expect(html).toContain("width:calc(2 * var(--board-cell-size) + 1 * 2px)");
  });
});
