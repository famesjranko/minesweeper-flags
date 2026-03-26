import type { MatchStateDto } from "@minesweeper-flags/shared";
import { BoardGrid } from "../../entities/board/BoardGrid.js";
import { FlagIcon } from "../../shared-ui/FlagIcon.js";
import { RematchPanel } from "../rematch/RematchPanel.js";

interface MatchViewProps {
  roomCode: string;
  currentPlayerId: string;
  match: MatchStateDto;
  bombArmed: boolean;
  onToggleBomb: () => void;
  onCellSelect: (row: number, column: number) => void;
  onResign: () => void;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
}

export const MatchView = ({
  roomCode,
  currentPlayerId,
  match,
  bombArmed,
  onToggleBomb,
  onCellSelect,
  onResign,
  onRequestRematch,
  onCancelRematch
}: MatchViewProps) => {
  const [bluePlayer, redPlayer] = match.players;
  const currentPlayer = match.players.find((player) => player.playerId === currentPlayerId) ?? null;
  const opponent = match.players.find((player) => player.playerId !== currentPlayerId) ?? null;
  const canAct = match.phase === "live" && match.currentTurnPlayerId === currentPlayerId;
  const canBomb = Boolean(
    currentPlayer &&
      opponent &&
      currentPlayer.bombsRemaining === 1 &&
      currentPlayer.score < opponent.score
  );
  const playerTones: Record<string, "blue" | "red"> = {
    [bluePlayer.playerId]: "blue",
    [redPlayer.playerId]: "red"
  };
  const activeTone =
    match.currentTurnPlayerId && playerTones[match.currentTurnPlayerId]
      ? playerTones[match.currentTurnPlayerId]
      : "blue";
  const playerSlots = [
    {
      title: "BLUE",
      tone: "blue" as const,
      player: bluePlayer,
      isSelf: bluePlayer.playerId === currentPlayerId,
      isTurn: match.currentTurnPlayerId === bluePlayer.playerId
    },
    {
      title: "RED",
      tone: "red" as const,
      player: redPlayer,
      isSelf: redPlayer.playerId === currentPlayerId,
      isTurn: match.currentTurnPlayerId === redPlayer.playerId
    }
  ];
  const renderPlayerSlot = (slot: (typeof playerSlots)[number]) => (
    <section
      key={slot.player.playerId}
      className={[
        "sidebar-player-panel",
        `sidebar-player-panel-${slot.tone}`,
        slot.isTurn ? "is-turn" : "",
        slot.isSelf ? "is-self" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="sidebar-player-header">
        <span className="sidebar-player-title">{slot.title}</span>
        <span className="sidebar-player-role">{slot.isSelf ? "YOU" : "OPPONENT"}</span>
      </header>

      <div className="sidebar-player-avatar">
        <span>{slot.player.displayName.slice(0, 1).toUpperCase()}</span>
      </div>

      <p className="sidebar-player-name">{slot.player.displayName}</p>
      <p className="sidebar-player-connection">
        {slot.player.connected ? "Connected" : "Disconnected"}
      </p>

      <div className="sidebar-score-strip">
        <div className="sidebar-pill sidebar-score-pill">
          <FlagIcon color={slot.tone} size={22} />
          <strong>{slot.player.score}</strong>
        </div>
        <button
          className={[
            "sidebar-pill",
            "sidebar-bomb-pill",
            slot.isSelf && bombArmed ? "is-armed" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={slot.isSelf ? onToggleBomb : undefined}
          disabled={!slot.isSelf || !canAct || !canBomb}
          title="Bomb: one use only, and only while trailing."
        >
          {slot.player.bombsRemaining ? "X" : "-"}
        </button>
      </div>

      <div className="sidebar-turn-box">
        {match.phase === "finished" ? (
          <p>
            {match.winnerPlayerId === slot.player.playerId
              ? "Winner"
              : match.winnerPlayerId
                ? "Defeated"
              : "Draw"}
          </p>
        ) : slot.isSelf ? (
          <p>
            {slot.isTurn
              ? bombArmed
                ? "Bomb armed.\nPick center."
                : "It's your turn!\nMake a move."
              : "Wait your turn."}
          </p>
        ) : slot.isTurn ? (
          <p>{`${slot.title} is moving.`}</p>
        ) : (
          <p>{`${slot.title} is waiting.`}</p>
        )}
      </div>
    </section>
  );

  return (
    <div className="classic-game-window">
      <div className="classic-match-shell">
        <aside className="classic-sidebar-frame">
          {renderPlayerSlot(playerSlots[0])}

          <div className="sidebar-center-strip">
            <div className="star-meter">
              <span className="star-glyph">★</span>
              <strong>{match.turnNumber}</strong>
              <span className="star-glyph">★</span>
            </div>
            <div className="room-code-pill">Room {roomCode}</div>
            <div className={`move-pill move-pill-${activeTone}`}>
              {match.phase === "finished" ? "MATCH OVER" : `${activeTone.toUpperCase()} MOVE`}
            </div>
          </div>

        {renderPlayerSlot(playerSlots[1])}

        <button
          className="sidebar-resign-button"
          disabled={match.phase !== "live"}
          onClick={() => {
            if (window.confirm("Resign this match?")) {
              onResign();
            }
          }}
        >
          RESIGN
        </button>
      </aside>

        <section className="classic-board-shell">
          <div className="classic-board-frame">
            <BoardGrid
              match={match}
              canAct={canAct}
              bombArmed={bombArmed}
              playerTones={playerTones}
              onSelectCell={onCellSelect}
            />
          </div>

          {match.phase === "finished" ? (
            <RematchPanel
              match={match}
              currentPlayerId={currentPlayerId}
              onRequestRematch={onRequestRematch}
              onCancelRematch={onCancelRematch}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
};
