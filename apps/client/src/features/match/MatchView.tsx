import {
  type ChatMessageDto,
  type MatchStateDto,
  MIN_BOMB_DEFICIT
} from "@minesweeper-flags/shared";
import { useState } from "react";
import { BoardGrid } from "../../entities/board/BoardGrid.js";
import {
  advanceLastMoveTrail,
  getLastMoveMarks,
  type LastMoveTrail
} from "../../entities/board/last-move.js";
import { ChatPanel } from "../chat/ChatPanel.js";
import { MatchResultRibbon } from "./MatchResultRibbon.js";
import { getPlayerSlots, PlayerPanel, type PlayerSlot } from "./PlayerPanel.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

interface MatchViewProps {
  roomCode: string;
  currentPlayerId: string;
  match: MatchStateDto;
  bombArmed: boolean;
  connectionStatus: ConnectionStatus;
  chatMessages: ChatMessageDto[];
  chatError: string | null;
  chatDraft: string;
  chatPending: boolean;
  onToggleBomb: () => void;
  onCellSelect: (row: number, column: number) => void;
  onChatDraftChange: (value: string) => void;
  onSendChatMessage: () => void;
  onResign: () => void;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
}

const ResignButton = ({ disabled, onResign }: { disabled: boolean; onResign: () => void }) => (
  <button
    type="button"
    className="sidebar-resign-button"
    disabled={disabled}
    onClick={() => {
      if (window.confirm("Resign this match?")) {
        onResign();
      }
    }}
  >
    RESIGN
  </button>
);

const getTurnHint = (match: MatchStateDto, currentPlayerId: string) => {
  if (match.phase === "finished") {
    return undefined;
  }

  return match.currentTurnPlayerId === currentPlayerId ? "YOU" : "OPPONENT";
};

const MatchCenterStrip = ({
  match,
  roomCode,
  currentPlayerId,
  activeTone
}: {
  match: MatchStateDto;
  roomCode: string;
  currentPlayerId: string;
  activeTone: "blue" | "red";
}) => (
  <div className="sidebar-center-strip">
    <div className="star-meter">
      <span className="star-glyph">★</span>
      <strong>{match.turnNumber}</strong>
      <span className="star-glyph">★</span>
    </div>
    <div className="room-code-pill">Room {roomCode}</div>
    {/* The hint is shown by the narrow-screen CSS only, where the per-player turn boxes are hidden. */}
    <div
      className={`move-pill move-pill-${activeTone}`}
      data-turn-hint={getTurnHint(match, currentPlayerId)}
    >
      {match.phase === "finished" ? "MATCH OVER" : `${activeTone.toUpperCase()} MOVE`}
    </div>
  </div>
);

export const MatchView = ({
  roomCode,
  currentPlayerId,
  match,
  bombArmed,
  connectionStatus,
  chatMessages,
  chatError,
  chatDraft,
  chatPending,
  onToggleBomb,
  onCellSelect,
  onChatDraftChange,
  onSendChatMessage,
  onResign,
  onRequestRematch,
  onCancelRematch
}: MatchViewProps) => {
  const [bluePlayer, redPlayer] = match.players;
  // Derive the trail during render so a refresh falls back to lastAction alone
  // and the marks never lag one render behind the snapshot.
  const [storedTrail, setStoredTrail] = useState<LastMoveTrail>([]);
  const lastMoveTrail = advanceLastMoveTrail(storedTrail, match, currentPlayerId);
  if (lastMoveTrail !== storedTrail) {
    setStoredTrail(lastMoveTrail);
  }
  const currentPlayer = match.players.find((player) => player.playerId === currentPlayerId) ?? null;
  const opponent = match.players.find((player) => player.playerId !== currentPlayerId) ?? null;
  const canAct = match.phase === "live" && match.currentTurnPlayerId === currentPlayerId;
  const scoreDeficit = currentPlayer && opponent ? opponent.score - currentPlayer.score : 0;
  const canBomb = Boolean(
    currentPlayer &&
      opponent &&
      currentPlayer.bombsRemaining === 1 &&
      scoreDeficit >= MIN_BOMB_DEFICIT
  );
  const playerTones: Record<string, "blue" | "red"> = {
    [bluePlayer.playerId]: "blue",
    [redPlayer.playerId]: "red"
  };
  const activeTone =
    (match.currentTurnPlayerId ? playerTones[match.currentTurnPlayerId] : undefined) ?? "blue";
  const playerSlots = getPlayerSlots(match, currentPlayerId);
  const renderPlayerPanel = (slot: PlayerSlot) => (
    <PlayerPanel
      key={slot.player.playerId}
      slot={slot}
      match={match}
      bombArmed={bombArmed}
      canAct={canAct}
      canBomb={canBomb}
      scoreDeficit={scoreDeficit}
      onToggleBomb={onToggleBomb}
    />
  );

  return (
    <div className="classic-game-window">
      <div className="classic-match-shell">
        <aside className="classic-sidebar-frame">
          {renderPlayerPanel(playerSlots[0])}

          <MatchCenterStrip
            match={match}
            roomCode={roomCode}
            currentPlayerId={currentPlayerId}
            activeTone={activeTone}
          />

          {renderPlayerPanel(playerSlots[1])}

          <ResignButton disabled={match.phase !== "live"} onResign={onResign} />
        </aside>

        <section className="classic-main-shell">
          <div className="classic-board-shell">
            <div className="classic-board-frame">
              <BoardGrid
                match={match}
                canAct={canAct}
                bombArmed={bombArmed}
                playerTones={playerTones}
                lastMove={getLastMoveMarks(
                  lastMoveTrail,
                  match.board.rows,
                  match.board.columns,
                  playerTones
                )}
                onSelectCell={onCellSelect}
              />
              {match.phase === "finished" ? (
                <MatchResultRibbon
                  match={match}
                  currentPlayerId={currentPlayerId}
                  playerTones={playerTones}
                  onRequestRematch={onRequestRematch}
                  onCancelRematch={onCancelRematch}
                />
              ) : null}
            </div>
          </div>
        </section>

        <ChatPanel
          roomCode={roomCode}
          currentPlayerId={currentPlayerId}
          playerTones={playerTones}
          connectionStatus={connectionStatus}
          messages={chatMessages}
          draft={chatDraft}
          pending={chatPending}
          error={chatError}
          helperText={
            opponent
              ? `${opponent.displayName} is ${opponent.connected ? "online" : "offline"}.`
              : "Waiting for the second player to join chat."
          }
          className="classic-match-chat"
          onDraftChange={onChatDraftChange}
          onSend={onSendChatMessage}
        />
      </div>
    </div>
  );
};
