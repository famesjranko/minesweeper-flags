// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardGrid } from "./BoardGrid.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Cell = MatchStateDto["board"]["cells"][number][number];

const hidden = (row: number, column: number): Cell => ({
  row,
  column,
  status: "hidden",
  adjacentMines: null,
  claimedByPlayerId: null
});

const createBoard = (change?: (cells: Cell[][]) => void): MatchStateDto => {
  const cells = [0, 1, 2].map((row) => [0, 1, 2].map((column) => hidden(row, column)));
  change?.(cells);
  return { board: { rows: 3, columns: 3, mineCount: 1, cells } } as unknown as MatchStateDto;
};

let container: HTMLDivElement;
let root: Root;
const onSelectCell = vi.fn();

const render = (match: MatchStateDto, { canAct = true, bombArmed = false } = {}) =>
  act(() =>
    root.render(
      <BoardGrid
        match={match}
        canAct={canAct}
        bombArmed={bombArmed}
        playerTones={{ blue: "blue", red: "red" }}
        onSelectCell={onSelectCell}
      />
    )
  );

const cellAt = (row: number, column: number) =>
  container.querySelector<HTMLButtonElement>(`[data-cell="${row}-${column}"]`)!;

const press = (key: string, modifiers: KeyboardEventInit = {}) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...modifiers })
    );
  });

describe("BoardGrid keyboard and screen reader support", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    onSelectCell.mockClear();
  });

  it("gives the whole board one tab stop that follows the arrow keys", () => {
    // Given a board whose first cell has focus
    render(createBoard());
    act(() => cellAt(0, 0).focus());

    // When the player presses right and then down
    press("ArrowRight");
    press("ArrowDown");

    // Then focus moves to that cell and it alone is in the tab order
    expect(document.activeElement).toBe(cellAt(1, 1));
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(cellAt(1, 1).tabIndex).toBe(0);
    expect(cellAt(0, 0).tabIndex).toBe(-1);
  });

  it.each([
    ["ArrowLeft", 1, 0],
    ["ArrowUp", 0, 1],
    ["ArrowRight", 1, 2],
    ["ArrowDown", 2, 1],
    ["Home", 1, 0],
    ["End", 1, 2]
  ])("moves one step with %s from the middle of the board", (key, row, column) => {
    // Given focus on the middle cell
    render(createBoard());
    act(() => cellAt(1, 1).focus());

    // When the player presses the key
    press(key);

    // Then focus lands on the expected neighbour
    expect(document.activeElement).toBe(cellAt(row, column));
  });

  it.each([
    ["ArrowLeft", 0, 0],
    ["ArrowUp", 0, 0],
    ["ArrowRight", 2, 2],
    ["ArrowDown", 2, 2]
  ])("stays on the board when %s meets its edge", (key, row, column) => {
    // Given focus on a corner cell
    render(createBoard());
    act(() => cellAt(row, column).focus());

    // When the player presses towards the edge
    press(key);

    // Then focus does not move
    expect(document.activeElement).toBe(cellAt(row, column));
  });

  it("leaves Alt+Arrow to the browser", () => {
    // Given focus on a cell
    render(createBoard());
    act(() => cellAt(1, 1).focus());

    // When the player presses the browser's back shortcut
    press("ArrowLeft", { altKey: true });

    // Then the board ignores it
    expect(document.activeElement).toBe(cellAt(1, 1));
  });

  it("keeps focus on the chosen cell after it opens and the turn passes", () => {
    // Given focus on a hidden cell the player can choose
    render(createBoard());
    act(() => cellAt(1, 1).focus());

    // When the move resolves and the opponent takes the turn
    render(
      createBoard((cells) => {
        cells[1]![1] = { ...hidden(1, 1), status: "revealed", adjacentMines: 2 };
      }),
      { canAct: false }
    );

    // Then focus stays there and now describes the opened cell
    expect(document.activeElement).toBe(cellAt(1, 1));
    expect(cellAt(1, 1).getAttribute("aria-label")).toBe("Row 2, column 2, 2 adjacent mines");
  });

  it("sends no move from a cell that cannot act", () => {
    // Given an opened cell during the player's turn and a hidden cell during the opponent's
    render(
      createBoard((cells) => {
        cells[0]![0] = { ...hidden(0, 0), status: "revealed", adjacentMines: 1 };
      })
    );

    // When the player activates the opened cell
    act(() => cellAt(0, 0).click());
    render(createBoard(), { canAct: false });

    // And activates a hidden cell out of turn
    act(() => cellAt(1, 1).click());

    // Then no move is sent and the cell says it is unavailable
    expect(onSelectCell).not.toHaveBeenCalled();
    expect(cellAt(1, 1).getAttribute("aria-disabled")).toBe("true");
  });

  it("sends the move for a hidden cell on the player's turn", () => {
    // Given a hidden cell on the player's turn
    render(createBoard());

    // When the player activates it
    act(() => cellAt(2, 1).click());

    // Then the move is sent once and the cell is not marked unavailable
    expect(onSelectCell).toHaveBeenCalledExactlyOnceWith(2, 1);
    expect(cellAt(2, 1).hasAttribute("aria-disabled")).toBe(false);
  });

  it.each([
    ["a hidden cell", {}, "Row 1, column 1, hidden"],
    [
      "an opened cell with no neighbours",
      { status: "revealed", adjacentMines: 0 },
      "Row 1, column 1, no adjacent mines"
    ],
    [
      "an opened cell with one neighbour",
      { status: "revealed", adjacentMines: 1 },
      "Row 1, column 1, 1 adjacent mine"
    ],
    [
      "a cell flagged by red",
      { status: "claimed", claimedByPlayerId: "red" },
      "Row 1, column 1, red flag"
    ],
    ["an exposed mine", { status: "mine-revealed" }, "Row 1, column 1, mine"]
  ] as const)("names %s", (_name, cell, label) => {
    // Given a board holding that cell
    render(
      createBoard((cells) => {
        cells[0]![0] = { ...hidden(0, 0), ...cell };
      })
    );

    // When a screen reader reads the cell
    const name = cellAt(0, 0).getAttribute("aria-label");

    // Then the name gives its position and its state
    expect(name).toBe(label);
  });

  it("exposes the board as a grid of rows", () => {
    // Given a three by three board
    render(createBoard());

    // When a screen reader reads its structure
    const grid = container.querySelector('[role="grid"]');

    // Then it has the board's dimensions and three rows of three cells
    expect(grid?.getAttribute("aria-rowcount")).toBe("3");
    expect(grid?.getAttribute("aria-colcount")).toBe("3");
    expect(grid?.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(grid?.querySelectorAll('[role="row"] > [role="gridcell"]')).toHaveLength(9);
  });

  it("moves the armed bomb's preview with the arrow keys", () => {
    // Given an armed bomb with focus on a hidden cell
    render(createBoard(), { bombArmed: true });
    act(() => cellAt(0, 0).focus());
    expect(cellAt(0, 0).classList.contains("bomb-preview-center")).toBe(true);

    // When the player moves one cell right
    press("ArrowRight");

    // Then the preview's centre moves with focus
    expect(cellAt(0, 0).classList.contains("bomb-preview-center")).toBe(false);
    expect(cellAt(0, 1).classList.contains("bomb-preview-center")).toBe(true);
  });
});

describe("BoardGrid turn and touch states", () => {
  const liveBoard = (change?: (cells: Cell[][]) => void) =>
    ({ ...createBoard(change), phase: "live" }) as MatchStateDto;

  const grid = () => container.querySelector('[role="grid"]')!;

  const tap = (target: HTMLElement, pointerType: string) =>
    act(() => {
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }));
      target.click();
    });

  const renderAiming = (match: MatchStateDto, onAimCell: (cell: unknown) => void) =>
    act(() =>
      root.render(
        <BoardGrid
          match={match}
          canAct
          bombArmed
          playerTones={{}}
          onSelectCell={onSelectCell}
          onAimCell={onAimCell}
        />
      )
    );

  beforeEach(() => {
    if (!("PointerEvent" in window)) {
      vi.stubGlobal("PointerEvent", MouseEvent);
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    onSelectCell.mockClear();
    vi.unstubAllGlobals();
  });

  it.each([
    ["while the player waits in a live match", "live", false, true],
    ["on the player's turn", "live", true, false],
    ["after the match has finished", "finished", false, false]
  ])("dims the hidden tiles only %s", (_name, phase, canAct, dimmed) => {
    // Given a match in that phase
    const match = { ...createBoard(), phase } as MatchStateDto;

    // When the board renders
    render(match, { canAct });

    // Then the waiting look matches the player's ability to move
    expect(grid().classList.contains("is-waiting")).toBe(dimmed);
  });

  it("aims rather than fires when a touch lands on an armed board", () => {
    // Given an armed bomb on a touch screen
    const onAimCell = vi.fn();
    renderAiming(liveBoard(), onAimCell);

    // When the player taps a hidden square
    tap(cellAt(1, 2), "touch");

    // Then the square is aimed at and nothing is sent
    expect(onAimCell).toHaveBeenCalledExactlyOnceWith({ row: 1, column: 2, pointerType: "touch" });
    expect(onSelectCell).not.toHaveBeenCalled();
  });

  it("aims rather than fires when a mouse click lands on an armed board", () => {
    // Given an armed bomb and a mouse
    const onAimCell = vi.fn();
    renderAiming(liveBoard(), onAimCell);

    // When the player clicks a hidden square
    tap(cellAt(1, 2), "mouse");

    // Then the square is aimed at and nothing is sent
    expect(onAimCell).toHaveBeenCalledExactlyOnceWith({ row: 1, column: 2, pointerType: "mouse" });
    expect(onSelectCell).not.toHaveBeenCalled();
  });

  it("fires at once for a key press that follows a touch", () => {
    // Given a tablet with a keyboard, where a touch on a finished cell left no aim
    const onAimCell = vi.fn();
    renderAiming(
      liveBoard((cells) => {
        cells[0]![0] = { ...hidden(0, 0), status: "revealed", adjacentMines: 1 };
      }),
      onAimCell
    );
    tap(cellAt(0, 0), "touch");
    act(() => cellAt(1, 1).focus());

    // When the player presses a key and then activates a hidden square, as Enter does
    press("ArrowRight");
    act(() => cellAt(1, 2).click());

    // Then the keyboard's preview counts, so the bomb is sent
    expect(onSelectCell).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(onAimCell).not.toHaveBeenCalled();
  });

  it("selects normally on touch when no bomb is armed", () => {
    // Given no armed bomb
    render(liveBoard());

    // When the player taps a hidden square
    tap(cellAt(0, 1), "touch");

    // Then it is an ordinary move
    expect(onSelectCell).toHaveBeenCalledExactlyOnceWith(0, 1);
  });

  it("shows the preview at the aimed square without any hover", () => {
    // Given an aimed bomb on a board that has no hover
    act(() =>
      root.render(
        <BoardGrid
          match={liveBoard()}
          canAct
          bombArmed
          playerTones={{}}
          aimedCell={{ row: 2, column: 2 }}
          onSelectCell={onSelectCell}
          onAimCell={vi.fn()}
        />
      )
    );

    // When the board renders
    const overlay = container.querySelector(".board-bomb-preview");

    // Then the overlay and its centre mark the aimed square
    expect(overlay).not.toBeNull();
    expect(cellAt(2, 2).classList.contains("bomb-preview-center")).toBe(true);
    expect(cellAt(0, 0).classList.contains("bomb-preview-center")).toBe(false);
  });

  it("animates only the cells that open while the board is on screen", () => {
    // Given a refreshed board where one cell was already open
    const opened = (cells: Cell[][]) => {
      cells[0]![0] = { ...hidden(0, 0), status: "revealed", adjacentMines: 1 };
    };
    render(liveBoard(opened));
    expect(container.querySelector(".is-new")).toBeNull();

    // When another cell opens during play
    render(
      liveBoard((cells) => {
        opened(cells);
        cells[1]![1] = { ...hidden(1, 1), status: "claimed", claimedByPlayerId: "blue" };
      })
    );

    // Then only the newly opened cell animates
    expect(container.querySelectorAll(".is-new")).toHaveLength(1);
    expect(cellAt(1, 1).classList.contains("is-new")).toBe(true);
  });

  it("animates a cell again in a rematch after it was open on mount", () => {
    // Given a cell that was open when the board mounted
    const opened = (cells: Cell[][]) => {
      cells[0]![0] = { ...hidden(0, 0), status: "revealed", adjacentMines: 1 };
    };
    render(liveBoard(opened));

    // When a rematch hides it and play opens it again
    render(liveBoard());
    render(liveBoard(opened));

    // Then this opening counts as new
    expect(cellAt(0, 0).classList.contains("is-new")).toBe(true);
  });

  it("marks the winner's colour on the grid while a win is celebrated", () => {
    // Given a finished match the viewer won
    act(() =>
      root.render(
        <BoardGrid
          match={createBoard()}
          canAct={false}
          bombArmed={false}
          playerTones={{}}
          celebrateTone="red"
          onSelectCell={onSelectCell}
        />
      )
    );

    // When the board renders
    const classes = grid().classList;

    // Then the wave applies to that colour
    expect(classes.contains("celebrate-red")).toBe(true);
  });
});
