import { type MatchStateDto, MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchView } from "./MatchView.js";

const createMatch = ({
  currentTurnPlayerId,
  scores
}: {
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

describe("MatchView turn hint", () => {
  const renderFor = (currentPlayerId: string) =>
    renderToStaticMarkup(
      <MatchView
        roomCode="ABCDE"
        currentPlayerId={currentPlayerId}
        match={createMatch({
          currentTurnPlayerId: "player-1",
          scores: [0, 0]
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

  it("tells the player on the narrow layout that it is their move", () => {
    // Given a live match where player-1 holds the turn
    // When player-1 views it
    const html = renderFor("player-1");

    // Then the move pill carries the YOU hint and keeps its desktop text
    expect(html).toContain('data-turn-hint="YOU"');
    expect(html).toContain("BLUE MOVE</div>");
  });

  it("tells the player on the narrow layout that the opponent is moving", () => {
    // Given a live match where player-1 holds the turn
    // When player-2 views it
    const html = renderFor("player-2");

    // Then the move pill carries the OPPONENT hint
    expect(html).toContain('data-turn-hint="OPPONENT"');
  });
});

describe("MatchView last-move marks", () => {
  const sized = (size: number, lastAction: MatchStateDto["lastAction"]): MatchStateDto => {
    const base = createMatch({
      currentTurnPlayerId: "player-1",
      scores: [0, 0]
    });
    return {
      ...base,
      board: {
        ...base.board,
        rows: size,
        columns: size,
        cells: Array.from({ length: size }, (_, row) =>
          Array.from({ length: size }, (_, column) => ({
            row,
            column,
            status: "hidden" as const,
            adjacentMines: null,
            claimedByPlayerId: null
          }))
        )
      },
      lastAction
    };
  };

  const renderMatch = (match: MatchStateDto) =>
    renderToStaticMarkup(
      <MatchView
        roomCode="ABCDE"
        currentPlayerId="player-1"
        match={match}
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

  const opponentAction = (
    overrides: Partial<NonNullable<MatchStateDto["lastAction"]>>
  ): NonNullable<MatchStateDto["lastAction"]> => ({
    type: "select",
    playerId: "player-2",
    row: 1,
    column: 2,
    outcome: "safe_reveal",
    revealedCount: 1,
    claimedMineCount: 0,
    ...overrides
  });

  it("marks exactly the cell the opponent selected", () => {
    // Given the opponent's last action selected row 2, column 3
    const html = renderMatch(sized(8, opponentAction({})));

    // When the match renders
    // Then only that cell carries is-last-move, in the opponent's tone
    expect(html.match(/is-last-move/g)).toHaveLength(1);
    expect(html).toMatch(/is-last-move last-move-red last-move-age-0[^>]*title="Row 2, Column 3"/);
  });

  it("outlines a bomb on a 2x2 board as the whole board and rings the centre only", () => {
    // Given the opponent bombed the top-left corner of a 2x2 board
    const html = renderMatch(
      sized(2, opponentAction({ type: "bomb", row: 0, column: 0, outcome: "bomb_used" }))
    );

    // When the match renders
    // Then the area spans the whole clamped 2x2 and only the centre cell is ringed
    expect(html).toContain("board-last-move-area last-move-red last-move-age-0");
    expect(html).toContain("width:calc(2 * var(--board-cell-size) + 1 * 2px)");
    expect(html.match(/is-last-move/g)).toHaveLength(1);
  });

  it("clamps a corner bomb on a larger board to a 5x5 area", () => {
    // Given the opponent bombed the corner of an 8x8 board
    const html = renderMatch(
      sized(8, opponentAction({ type: "bomb", row: 0, column: 0, outcome: "bomb_used" }))
    );

    // When the match renders
    // Then the outline spans 5 cells from the top-left
    expect(html).toContain("width:calc(5 * var(--board-cell-size) + 4 * 2px)");
    expect(html).toContain("left:calc(8px + 0 * (var(--board-cell-size) + 2px))");
  });

  it("marks nothing when there is no last action", () => {
    // Given a fresh match
    // When it renders
    // Then no marker appears
    expect(renderMatch(sized(4, null))).not.toContain("is-last-move");
  });

  it("marks nothing for the viewing player's own action", () => {
    // Given the viewer made the last action
    const html = renderMatch(sized(4, opponentAction({ playerId: "player-1" })));

    // When it renders
    // Then no marker appears
    expect(html).not.toContain("is-last-move");
    expect(html).not.toContain("board-last-move-area");
  });
});
