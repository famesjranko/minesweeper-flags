import { type MatchStateDto, MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { BombIcon } from "../../shared-ui/BombIcon.js";
import { CrownIcon } from "../../shared-ui/CrownIcon.js";

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

interface BombState {
  bombArmed: boolean;
  // The slot is the current player, it is their turn, and the bomb rules allow a bomb.
  isReady: boolean;
}

const getBombVariant = (slot: PlayerSlot, { bombArmed, isReady }: BombState) => {
  if (slot.player.bombsRemaining === 0) {
    return "spent";
  }

  if (slot.isSelf && bombArmed) {
    return "armed";
  }

  return isReady ? "ready" : "idle";
};

const getBombLabel = (slot: PlayerSlot, { bombArmed, isReady }: BombState): string => {
  if (slot.player.bombsRemaining === 0) {
    return `${slot.isSelf ? "Your" : "Opponent"} bomb is spent.`;
  }

  if (isReady) {
    return bombArmed
      ? "Bomb armed. Pick the center of a 5x5 blast."
      : "Bomb ready. Click to arm a 5x5 blast.";
  }

  return slot.isSelf
    ? `Bomb unused. It becomes available while trailing by ${MIN_BOMB_DEFICIT} or more on your turn.`
    : "Opponent bomb status.";
};

interface PlayerPanelProps {
  slot: PlayerSlot;
  match: MatchStateDto;
}

export const PlayerPanel = ({ slot, match }: PlayerPanelProps) => {
  const isWinner = match.phase === "finished" && match.winnerPlayerId === slot.player.playerId;

  return (
    <section
      className={[
        "sidebar-player-panel",
        `sidebar-player-panel-${slot.tone}`,
        slot.isTurn ? "is-turn" : "",
        slot.isSelf ? "is-self" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="arcade-player-identity">
        <header className="sidebar-player-header">
          <span>
            {slot.title} · {slot.isSelf ? "You" : "Opponent"}
          </span>
          <span
            className={`arcade-player-presence${slot.player.connected ? " is-online" : ""}`}
            role="img"
            aria-label={slot.player.connected ? "Connected" : "Disconnected"}
          />
        </header>
        <p className="sidebar-player-name" title={slot.player.displayName}>
          {slot.player.displayName}
        </p>
      </div>
      <div className={`sidebar-score-pill${isWinner ? " is-winner" : ""}`}>
        {isWinner ? <CrownIcon className="winner-crown" /> : null}
        <strong>{slot.player.score}</strong>
      </div>
    </section>
  );
};

interface PlayerBombButtonProps {
  slot: PlayerSlot;
  bombArmed: boolean;
  canAct: boolean;
  canBomb: boolean;
  onToggleBomb: () => void;
}

export const PlayerBombButton = ({
  slot,
  bombArmed,
  canAct,
  canBomb,
  onToggleBomb
}: PlayerBombButtonProps) => {
  const bombState = { bombArmed, isReady: slot.isSelf && canAct && canBomb };
  const spent = slot.player.bombsRemaining === 0;

  return (
    <button
      type="button"
      aria-label={getBombLabel(slot, bombState)}
      aria-pressed={bombArmed}
      className={[
        "sidebar-bomb-pill",
        bombState.isReady ? "is-ready" : "",
        bombArmed ? "is-armed" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggleBomb}
      disabled={!canAct || !canBomb}
      title={
        bombState.isReady
          ? "Bomb ready: click to arm a 5x5 blast."
          : `Bomb: one use only, and only while trailing by ${MIN_BOMB_DEFICIT} or more.`
      }
    >
      <BombIcon className="sidebar-bomb-icon" variant={getBombVariant(slot, bombState)} size={19} />
      <span>
        {spent
          ? "Bomb used"
          : bombArmed
            ? "Disarm bomb"
            : bombState.isReady
              ? "Use bomb"
              : "Bomb locked"}
      </span>
    </button>
  );
};
