import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatchStateDto } from "@minesweeper-flags/shared";
import { RematchPanel } from "./RematchPanel.js";

const createFinishedMatch = (
  overrides: Partial<MatchStateDto["players"][number]>[] = []
): MatchStateDto => ({
  roomId: "room-1",
  phase: "finished",
  board: {
    rows: 16,
    columns: 16,
    mineCount: 51,
    cells: Array.from({ length: 16 }, (_, row) =>
      Array.from({ length: 16 }, (_, column) => ({
        row,
        column,
        status: "hidden" as const,
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  },
  players: [
    {
      playerId: "player-1",
      displayName: "Host",
      score: 26,
      bombsRemaining: 0,
      connected: true,
      rematchRequested: false,
      ...overrides[0]
    },
    {
      playerId: "player-2",
      displayName: "Guest",
      score: 25,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false,
      ...overrides[1]
    }
  ],
  currentTurnPlayerId: null,
  turnPhase: "ended",
  turnNumber: 24,
  winnerPlayerId: "player-1",
  lastAction: null
});

describe("RematchPanel", () => {
  it("shows a waiting state for the player who already requested the rematch", () => {
    const html = renderToStaticMarkup(
      <RematchPanel
        match={createFinishedMatch([{ rematchRequested: true }])}
        currentPlayerId="player-1"
        onRequestRematch={() => {}}
        onCancelRematch={() => {}}
      />
    );

    expect(html).toContain("Waiting for the other player to confirm the rematch.");
    expect(html).toContain("Cancel Rematch");
  });

  it("shows an accept state for the other player once a rematch is requested", () => {
    const html = renderToStaticMarkup(
      <RematchPanel
        match={createFinishedMatch([{ rematchRequested: true }])}
        currentPlayerId="player-2"
        onRequestRematch={() => {}}
        onCancelRematch={() => {}}
      />
    );

    expect(html).toContain("The other player requested a rematch. Confirm to start the next round.");
    expect(html).toContain("Accept Rematch");
  });
});
