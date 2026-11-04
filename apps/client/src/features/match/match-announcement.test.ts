import type { MatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { describeLastAction } from "./match-announcement.js";

type Action = NonNullable<MatchStateDto["lastAction"]>;

const createMatch = (lastAction: Partial<Action> | null): MatchStateDto =>
  ({
    players: [
      { playerId: "blue", displayName: "Ana", score: 3 },
      { playerId: "red", displayName: "Bo", score: 5 }
    ],
    lastAction: lastAction && {
      type: "select",
      playerId: "red",
      row: 1,
      column: 2,
      outcome: "safe_reveal",
      revealedCount: 1,
      claimedMineCount: 0,
      ...lastAction
    }
  }) as unknown as MatchStateDto;

describe("describeLastAction", () => {
  it("stays silent before the first move", () => {
    // Given a match with no moves
    // When the announcement is built
    const text = describeLastAction(createMatch(null), "blue");

    // Then there is nothing to read
    expect(text).toBe("");
  });

  it.each([
    [
      "the opponent claims a mine",
      { outcome: "mine_claimed" },
      "blue",
      "Bo claimed a mine at row 2, column 3. Score: You 3, Bo 5."
    ],
    [
      "the player opens one square",
      { playerId: "blue" },
      "blue",
      "You opened 1 square at row 2, column 3. Score: You 3, Bo 5."
    ],
    [
      "the opponent opens a region",
      { revealedCount: 12 },
      "blue",
      "Bo opened 12 squares at row 2, column 3. Score: You 3, Bo 5."
    ],
    [
      "a bomb claims one mine",
      { type: "bomb", outcome: "bomb_used", claimedMineCount: 1 },
      "red",
      "You bombed row 2, column 3 and claimed 1 mine. Score: Ana 3, You 5."
    ],
    [
      "a bomb claims several mines",
      { type: "bomb", outcome: "bomb_used", claimedMineCount: 3 },
      "blue",
      "Bo bombed row 2, column 3 and claimed 3 mines. Score: You 3, Bo 5."
    ]
  ] as const)("reads %s", (_name, action, viewer, expected) => {
    // Given a match whose last action is that move
    // When the viewer's announcement is built
    const text = describeLastAction(createMatch(action), viewer);

    // Then it names the mover, the place, the result and the score
    expect(text).toBe(expected);
  });
});
