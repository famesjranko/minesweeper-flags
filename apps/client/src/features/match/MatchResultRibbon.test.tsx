import type { MatchStateDto } from "@minesweeper-flags/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchRematchAction, MatchResultRibbon } from "./MatchResultRibbon.js";

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

const tones = { "player-1": "blue", "player-2": "red" } as const;

const render = (match: MatchStateDto, currentPlayerId: string) =>
  renderToStaticMarkup(
    <MatchResultRibbon match={match} currentPlayerId={currentPlayerId} playerTones={tones} />
  );

const renderRematch = (match: MatchStateDto, currentPlayerId: string) =>
  renderToStaticMarkup(
    <MatchRematchAction
      match={match}
      currentPlayerId={currentPlayerId}
      onRequestRematch={() => {}}
      onCancelRematch={() => {}}
    />
  );

describe("MatchResultRibbon", () => {
  it("tells the winner they won, in their colour, with the score", () => {
    // Given a finished match that player-1 (blue) won 26 to 25
    const match = createFinishedMatch();

    // When the winner's screen renders the ribbon
    const html = render(match, "player-1");

    // Then it says the player won, in blue, highest score first
    expect(html).toContain("You won");
    expect(html).toContain("is-blue");
    expect(html).toContain("26 – 25");
  });

  it("names the winner on the other player's screen", () => {
    // Given the same finished match
    const match = createFinishedMatch();

    // When the losing player's screen renders the ribbon
    const html = render(match, "player-2");

    // Then it names the winner instead of saying "You won"
    expect(html).toContain("Host won");
    expect(html).not.toContain("You won");
    expect(html).toContain("is-blue");
  });

  it("explains a win by resignation when the winner trails on score", () => {
    // Given player-2 won because player-1 resigned while ahead 26 to 25
    const match = { ...createFinishedMatch(), winnerPlayerId: "player-2" };

    // When either screen renders the ribbon
    const html = render(match, "player-2");

    // Then the winner's score comes first and the resignation is named
    expect(html).toContain("You won");
    expect(html).toContain("25 – 26 by resignation");
  });

  it("shows a tie as a draw in a neutral colour", () => {
    // Given a finished match with no winner
    const match = { ...createFinishedMatch([{ score: 25 }]), winnerPlayerId: null };

    // When either screen renders the ribbon
    const html = render(match, "player-1");

    // Then it says draw without a player colour
    expect(html).toContain("Draw");
    expect(html).toContain("is-draw");
  });

  it("offers a rematch before either player asks", () => {
    // Given a finished match with no rematch requests
    const match = createFinishedMatch();

    // When the ribbon renders
    const html = renderRematch(match, "player-2");

    // Then it offers to request one
    expect(html).toContain("Request Rematch");
  });

  it("waits, with a cancel, after this player asks for a rematch", () => {
    // Given player-1 has asked for a rematch
    const match = createFinishedMatch([{ rematchRequested: true }]);

    // When player-1's screen renders the ribbon
    const html = renderRematch(match, "player-1");

    // Then it says it is waiting for the opponent and offers to cancel
    expect(html).toContain("Waiting for Guest");
    expect(html).toContain("Cancel Rematch");
  });

  it("offers to accept when the opponent asked first", () => {
    // Given player-1 has asked for a rematch
    const match = createFinishedMatch([{ rematchRequested: true }]);

    // When player-2's screen renders the ribbon
    const html = renderRematch(match, "player-2");

    // Then it says the opponent wants a rematch and offers to accept
    expect(html).toContain("Host wants a rematch");
    expect(html).toContain("Accept Rematch");
  });
});
