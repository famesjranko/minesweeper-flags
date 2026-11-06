import {
  BOARD_SIZES,
  type BoardSize,
  getBombDeficit,
  getWinningScore
} from "@minesweeper-flags/game-engine";
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

const createMatch = (boardSize: BoardSize): MatchStateDto => ({
  roomId: "layout-check",
  phase: "live",
  board: {
    ...BOARD_SIZES[boardSize],
    cells: Array.from({ length: BOARD_SIZES[boardSize].rows }, (_, row) =>
      Array.from({ length: BOARD_SIZES[boardSize].columns }, (_, column) => ({
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
  boardSize?: BoardSize;
  soloNotice?: boolean;
  solo?: boolean;
  emptyChat?: boolean;
  longChat?: boolean;
  longNames?: boolean;
  offline?: boolean;
  opponentTurn?: boolean;
  connecting?: boolean;
  finished?: boolean;
  scoreDeficit?: number;
  bombReady?: boolean;
  bombArmed?: boolean;
  rematch?: boolean;
}

export const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

const createFixtureMatch = (options: FixtureOptions): MatchStateDto => {
  const size = options.boardSize ?? "classic";
  const match = createMatch(size);
  if (options.longNames) {
    match.players[0].displayName = "Captain McSweeperman";
    match.players[1].displayName = "WWWWWWWWWWWWWWWWWWWW";
  }
  if (options.solo) {
    match.players[0].displayName = "You";
    match.players[1].displayName = "Bot";
  }
  if (options.offline) {
    match.players[1].connected = false;
    match.currentTurnPlayerId = "guest";
  }
  if (options.opponentTurn) match.currentTurnPlayerId = "guest";
  match.players[1].score = options.finished
    ? getWinningScore(BOARD_SIZES[size].mineCount)
    : options.bombReady
      ? getBombDeficit(BOARD_SIZES[size].mineCount)
      : (options.scoreDeficit ?? 0);
  for (const cell of match.board.cells.flat().slice(0, match.players[1].score)) {
    cell.status = "claimed";
    cell.claimedByPlayerId = "guest";
  }
  const last = BOARD_SIZES[size].rows - 1;
  const numbered = match.board.cells[last]![last]!;
  numbered.status = "revealed";
  numbered.adjacentMines = 2;
  if (options.rematch) match.players[0].rematchRequested = true;
  if (options.finished) {
    match.phase = "finished";
    match.turnPhase = "ended";
    match.winnerPlayerId = "guest";
    match.currentTurnPlayerId = null;
  }
  return match;
};

export const renderFixture = async (options: FixtureOptions = {}) => {
  const match = createFixtureMatch(options);
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
      {options.soloNotice ? (
        <p className="solo-notice" role="status">
          Resumed your 16×16 match. 20×20 starts with your next match.
        </p>
      ) : null}
      <MatchView {...shared} presentation="solo" botLevel="Normal" onRematch={noop} />
    </div>
  ) : (
    <MatchView
      {...shared}
      roomCode="ABCDE"
      connectionStatus={options.connecting ? "connecting" : "connected"}
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
