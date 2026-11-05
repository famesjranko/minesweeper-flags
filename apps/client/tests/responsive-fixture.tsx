import type { ChatMessageDto, MatchStateDto } from "@minesweeper-flags/shared";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MatchView } from "../src/features/match/MatchView.js";
import { ArcadeHeader } from "../src/shared-ui/ArcadeHeader.js";
import "../src/styles.css";
import "../src/solo/solo.css";

const root = createRoot(document.getElementById("root")!);
const noop = () => {};
const messages: ChatMessageDto[] = [
  { messageId: "1", playerId: "guest", displayName: "First Mate", text: "good luck :)", sentAt: 1 },
  { messageId: "2", playerId: "guest", displayName: "First Mate", text: "one more?", sentAt: 2 },
  { messageId: "3", playerId: "host", displayName: "Captain Sweeper", text: "you too!", sentAt: 3 },
  {
    messageId: "4",
    playerId: "host",
    displayName: "Captain Sweeper",
    text: "going for it",
    sentAt: 4
  }
];

const longChat: ChatMessageDto[] = Array.from({ length: 30 }, (_, index) => ({
  messageId: `long-${index}`,
  playerId: "guest",
  displayName: "First Mate",
  text:
    index % 10 === 0 ? "A longer message that wraps across several lines in a chat panel." : "ok",
  sentAt: index + 1
}));

const createMatch = (): MatchStateDto => ({
  roomId: "layout-check",
  phase: "live",
  board: {
    rows: 16,
    columns: 16,
    mineCount: 51,
    cells: Array.from({ length: 16 }, (_, row) =>
      Array.from({ length: 16 }, (_, column) => ({
        row,
        column,
        status: "hidden",
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  },
  players: [
    {
      playerId: "host",
      displayName: "Captain Sweeper",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "guest",
      displayName: "First Mate",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: "host",
  turnPhase: "awaiting_action",
  turnNumber: 1,
  winnerPlayerId: null,
  lastAction: null
});

export interface FixtureOptions {
  solo?: boolean;
  emptyChat?: boolean;
  longChat?: boolean;
  longNames?: boolean;
  offline?: boolean;
  finished?: boolean;
  scoreDeficit?: number;
  bombArmed?: boolean;
  rematch?: boolean;
}

export const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

export const renderFixture = async (options: FixtureOptions = {}) => {
  const match = createMatch();
  if (options.longNames) {
    match.players[0].displayName = "Captain McSweeperman";
    match.players[1].displayName = "WWWWWWWWWWWWWWWWWWWW";
  }
  if (options.offline) {
    match.players[1].connected = false;
    match.currentTurnPlayerId = "guest";
  }
  match.players[1].score = options.finished ? 26 : (options.scoreDeficit ?? 0);
  for (const cell of match.board.cells.flat().slice(0, match.players[1].score)) {
    cell.status = "claimed";
    cell.claimedByPlayerId = "guest";
  }
  const numbered = match.board.cells[15]![15]!;
  numbered.status = "revealed";
  numbered.adjacentMines = 2;
  if (options.rematch) match.players[0].rematchRequested = true;
  if (options.finished) {
    match.phase = "finished";
    match.turnPhase = "ended";
    match.winnerPlayerId = "guest";
    match.currentTurnPlayerId = null;
  }
  const shared = {
    match,
    currentPlayerId: "host",
    bombArmed: options.bombArmed ?? false,
    onToggleBomb: noop,
    onCellSelect: noop,
    onResign: noop
  };
  const view = options.solo ? (
    <div className="solo-match">
      <ArcadeHeader>
        <a className="solo-leave-link" href="/">
          Leave solo match
        </a>
      </ArcadeHeader>
      <MatchView {...shared} presentation="solo" onRematch={noop} />
    </div>
  ) : (
    <MatchView
      {...shared}
      roomCode="ABCDE"
      connectionStatus="connected"
      chatMessages={options.emptyChat ? [] : options.longChat ? longChat : messages}
      chatDraft=""
      chatPending={false}
      chatError={null}
      onChatDraftChange={noop}
      onSendChatMessage={noop}
      onRequestRematch={noop}
      onCancelRematch={noop}
    />
  );
  flushSync(() =>
    root.render(<main className="page-shell arcade-page-shell arcade-match-page">{view}</main>)
  );
  await nextPaint();
};
