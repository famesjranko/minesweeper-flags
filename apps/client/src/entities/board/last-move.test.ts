import type { MatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { advanceLastMoveTrail, getLastMoveMarks, type LastMoveTrail } from "./last-move.js";

type Action = NonNullable<MatchStateDto["lastAction"]>;

const action = (
  playerId: string,
  row: number,
  column: number,
  overrides: Partial<Action> = {}
): Action => ({
  type: "select",
  playerId,
  row,
  column,
  outcome: "mine_claimed",
  revealedCount: 0,
  claimedMineCount: 1,
  ...overrides
});

const tones = { me: "blue", opp: "red" } as const;

const play = (steps: Array<[number, Action | null]>): LastMoveTrail =>
  steps.reduce<LastMoveTrail>(
    (trail, [turnNumber, lastAction]) =>
      advanceLastMoveTrail(trail, { turnNumber, lastAction }, "me"),
    []
  );

describe("last move trail", () => {
  it("marks two mine claims then a safe reveal by the opponent, newest strongest", () => {
    // Given the opponent claims two mines and then reveals a safe cell
    const trail = play([
      [2, action("opp", 0, 0)],
      [3, action("opp", 0, 1)],
      [4, action("opp", 1, 1, { outcome: "safe_reveal" })]
    ]);

    // When the marks are computed
    const { cells } = getLastMoveMarks(trail, 4, 4, tones);

    // Then all three cells are marked and the newest has age 0
    expect(cells.map((c) => [c.row, c.column, c.age])).toEqual([
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 2]
    ]);
  });

  it("resets the trail when the viewing player acts", () => {
    // Given the opponent has moved twice
    // When the viewing player then acts
    const trail = play([
      [2, action("opp", 0, 0)],
      [3, action("opp", 0, 1)],
      [4, action("me", 2, 2)]
    ]);

    // Then nothing is marked
    expect(trail).toEqual([]);
    expect(getLastMoveMarks(trail, 4, 4, tones).cells).toEqual([]);
  });

  it("starts a fresh trail after the viewer's action", () => {
    // Given the viewer acted after an opponent move
    // When the opponent moves again
    const trail = play([
      [2, action("opp", 0, 0)],
      [3, action("me", 2, 2)],
      [4, action("opp", 3, 3)]
    ]);

    // Then only the new opponent move is marked
    expect(getLastMoveMarks(trail, 4, 4, tones).cells).toHaveLength(1);
  });

  it("clears the trail when lastAction becomes null, as in a rematch", () => {
    // Given an opponent move is marked
    // When a new match reports no last action
    const trail = play([
      [2, action("opp", 0, 0)],
      [1, null]
    ]);

    // Then no cell is marked
    expect(trail).toEqual([]);
  });

  it("ignores a repeated snapshot of the same turn", () => {
    // Given one opponent move
    const once = play([[2, action("opp", 0, 0)]]);

    // When the same snapshot arrives again
    const twice = advanceLastMoveTrail(
      once,
      { turnNumber: 2, lastAction: action("opp", 0, 0) },
      "me"
    );

    // Then the trail is unchanged
    expect(twice).toBe(once);
  });

  it("starts a fresh trail when a different action arrives at the same turn", () => {
    // Given an opponent move is marked at turn 6
    const once = play([[6, action("opp", 1, 1)]]);

    // When a snapshot at turn 6 carries a different action, as after a missed rematch reset
    const next = advanceLastMoveTrail(
      once,
      { turnNumber: 6, lastAction: action("opp", 9, 9) },
      "me"
    );

    // Then only the new action is marked
    expect(next.map((e) => [e.turnNumber, e.action.row, e.action.column])).toEqual([[6, 9, 9]]);
  });

  it("drops the old trail when a lower turn number arrives", () => {
    // Given opponent moves are marked up to turn 5
    // When a snapshot with a lower turn number arrives, as from a new match
    const trail = play([
      [4, action("opp", 0, 0)],
      [5, action("opp", 0, 1)],
      [2, action("opp", 3, 3)]
    ]);

    // Then only the new match's move is marked
    expect(trail.map((e) => [e.turnNumber, e.action.row, e.action.column])).toEqual([[2, 3, 3]]);
  });

  it("marks a corner bomb as the engine's shifted 5x5 area, with the centre cell", () => {
    // Given a corner bomb by the opponent
    const trail = play([[2, action("opp", 0, 0, { type: "bomb", outcome: "bomb_used" })]]);

    // When the marks are computed
    const marks = getLastMoveMarks(trail, 8, 8, tones);

    // Then the area is clamped to the board edge and the centre is marked
    expect(marks.areas[0]?.bounds).toEqual({ minRow: 0, maxRow: 4, minColumn: 0, maxColumn: 4 });
    expect(marks.cells).toEqual([{ row: 0, column: 0, age: 0, tone: "red" }]);
  });
});
