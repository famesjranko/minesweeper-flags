import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MIN_BOMB_DEFICIT, type MatchStateDto } from "@minesweeper-flags/shared";
import { MatchView } from "./MatchView.js";

const createMatch = ({
  currentPlayerId,
  currentTurnPlayerId,
  scores
}: {
  currentPlayerId: string;
  currentTurnPlayerId: string;
  scores: [number, number];
}): MatchStateDto => ({
  roomId: "room-1",
  phase: "live",
  board: {
    rows: 2,
    columns: 2,
    mineCount: 1,
    cells: [
      [
        { row: 0, column: 0, status: "hidden", adjacentMines: null, claimedByPlayerId: null },
        { row: 0, column: 1, status: "hidden", adjacentMines: null, claimedByPlayerId: null }
      ],
      [
        { row: 1, column: 0, status: "hidden", adjacentMines: null, claimedByPlayerId: null },
        { row: 1, column: 1, status: "hidden", adjacentMines: null, claimedByPlayerId: null }
      ]
    ]
  },
  players: [
    {
      playerId: "player-1",
      displayName: "Blue",
      score: scores[0],
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "player-2",
      displayName: "Red",
      score: scores[1],
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId,
  turnPhase: "awaiting_action",
  turnNumber: 8,
  winnerPlayerId: null,
  lastAction: null
});

describe("MatchView bomb availability", () => {
  it("shows a ready bomb state for the trailing player on their turn", () => {
    const html = renderToStaticMarkup(
      <MatchView
        roomCode="ABCDE"
        currentPlayerId="player-1"
        match={createMatch({
          currentPlayerId: "player-1",
          currentTurnPlayerId: "player-1",
          scores: [2, 2 + MIN_BOMB_DEFICIT]
        })}
        bombArmed={false}
        connectionStatus="connected"
        chatMessages={[]}
        chatError={null}
        chatDraft=""
        chatPending={false}
        onToggleBomb={() => {}}
        onCellSelect={() => {}}
        onChatDraftChange={() => {}}
        onSendChatMessage={() => {}}
        onResign={() => {}}
        onRequestRematch={() => {}}
        onCancelRematch={() => {}}
      />
    );

    expect(html).toContain("Bomb ready.");
    expect(html).toContain("sidebar-bomb-pill is-ready");
    expect(html).toContain("Bomb ready: click to arm a 5x5 blast.");
    expect(html).toContain("sidebar-bomb-icon");
    expect(html).not.toContain(">X<");
  });

  it("keeps the bomb locked below the comeback threshold", () => {
    const html = renderToStaticMarkup(
      <MatchView
        roomCode="ABCDE"
        currentPlayerId="player-1"
        match={createMatch({
          currentPlayerId: "player-1",
          currentTurnPlayerId: "player-1",
          scores: [8, 8 + (MIN_BOMB_DEFICIT - 1)]
        })}
        bombArmed={false}
        connectionStatus="connected"
        chatMessages={[]}
        chatError={null}
        chatDraft=""
        chatPending={false}
        onToggleBomb={() => {}}
        onCellSelect={() => {}}
        onChatDraftChange={() => {}}
        onSendChatMessage={() => {}}
        onResign={() => {}}
        onRequestRematch={() => {}}
        onCancelRematch={() => {}}
      />
    );

    expect(html).not.toContain("sidebar-bomb-pill is-ready");
    expect(html).toContain(`Bomb unlocks at down ${MIN_BOMB_DEFICIT}.`);
    expect(html).toContain(`trailing by ${MIN_BOMB_DEFICIT} or more`);
  });

  it("keeps the bomb unavailable for the leading player", () => {
    const html = renderToStaticMarkup(
      <MatchView
        roomCode="ABCDE"
        currentPlayerId="player-2"
        match={createMatch({
          currentPlayerId: "player-2",
          currentTurnPlayerId: "player-2",
          scores: [2, 2 + MIN_BOMB_DEFICIT]
        })}
        bombArmed={false}
        connectionStatus="connected"
        chatMessages={[]}
        chatError={null}
        chatDraft=""
        chatPending={false}
        onToggleBomb={() => {}}
        onCellSelect={() => {}}
        onChatDraftChange={() => {}}
        onSendChatMessage={() => {}}
        onResign={() => {}}
        onRequestRematch={() => {}}
        onCancelRematch={() => {}}
      />
    );

    expect(html).not.toContain("sidebar-bomb-pill is-ready");
    expect(html).not.toContain("Bomb ready.");
  });
});
