import { type MatchStateDto, MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { CrownIcon } from "../../shared-ui/CrownIcon.js";
import { PlayerBombButton } from "./PlayerBombButton.js";

export interface PlayerSlot {
  title: "BLUE" | "RED";
  tone: "blue" | "red";
  player: MatchStateDto["players"][number];
  isSelf: boolean;
  isTurn: boolean;
}

// Blue is always the first player and red the second.
export const getPlayerSlots = (
  match: MatchStateDto,
  currentPlayerId: string
): [PlayerSlot, PlayerSlot] => {
  const [bluePlayer, redPlayer] = match.players;

  return [
    {
      title: "BLUE",
      tone: "blue",
      player: bluePlayer,
      isSelf: bluePlayer.playerId === currentPlayerId,
      isTurn: match.currentTurnPlayerId === bluePlayer.playerId
    },
    {
      title: "RED",
      tone: "red",
      player: redPlayer,
      isSelf: redPlayer.playerId === currentPlayerId,
      isTurn: match.currentTurnPlayerId === redPlayer.playerId
    }
  ];
};

interface PlayerPanelProps {
  slot: PlayerSlot;
  match: MatchStateDto;
  hidePresence?: boolean;
  bombArmed: boolean;
  canAct: boolean;
  onToggleBomb: () => void;
}

export const PlayerPanel = ({ slot, match, hidePresence = false, ...bomb }: PlayerPanelProps) => {
  const opponent = match.players.find((player) => player.playerId !== slot.player.playerId);
  const canBomb = Boolean(opponent && opponent.score - slot.player.score >= MIN_BOMB_DEFICIT);
  const isWinner = match.phase === "finished" && match.winnerPlayerId === slot.player.playerId;

  return (
    <section
      aria-label={`${slot.title} · ${slot.isSelf ? "You" : "Opponent"} · ${slot.player.displayName}`}
      className={[
        "sidebar-player-panel",
        `sidebar-player-panel-${slot.tone}`,
        slot.isTurn && match.phase === "live" ? "is-turn" : "",
        isWinner ? "is-card-winner" : "",
        slot.isSelf ? "is-self" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="sidebar-player-name" title={slot.player.displayName}>
        <span className="player-name-text">{slot.player.displayName}</span>
        <span className="player-crown-slot">
          {isWinner ? <CrownIcon className="winner-crown" /> : null}
        </span>
      </p>
      <header className="sidebar-player-header">
        <span>
          {slot.title}
          {slot.isSelf ? " · You" : ""}
        </span>
        {!hidePresence ? (
          <span
            className={`arcade-player-presence${slot.player.connected ? " is-online" : ""}`}
            role="img"
            aria-label={slot.player.connected ? "Connected" : "Disconnected"}
          />
        ) : null}
      </header>
      <div className="card-inline-actions">
        <div className={`sidebar-score-pill${isWinner ? " is-winner" : ""}`}>
          <strong>{slot.player.score}</strong>
        </div>
        <PlayerBombButton
          {...bomb}
          slot={slot}
          canBomb={canBomb}
          finished={match.phase === "finished"}
        />
      </div>
    </section>
  );
};
