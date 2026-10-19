import { type MatchStateDto, MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { BombIcon } from "../../shared-ui/BombIcon.js";
import { FlagIcon } from "../../shared-ui/FlagIcon.js";

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

const getSelfTurnText = (
  slot: PlayerSlot,
  {
    bombArmed,
    canBomb,
    scoreDeficit
  }: { bombArmed: boolean; canBomb: boolean; scoreDeficit: number }
): string => {
  if (!slot.isTurn) {
    return "Wait your turn.";
  }

  if (bombArmed) {
    return "Bomb armed.\nPick center.";
  }

  if (canBomb) {
    return "It's your turn!\nBomb ready.";
  }

  return scoreDeficit > 0 && scoreDeficit < MIN_BOMB_DEFICIT
    ? `It's your turn!\nBomb unlocks at down ${MIN_BOMB_DEFICIT}.`
    : "It's your turn!\nMake a move.";
};

const getFinishedText = (slot: PlayerSlot, match: MatchStateDto): string => {
  if (match.winnerPlayerId === slot.player.playerId) {
    return "Winner";
  }

  return match.winnerPlayerId ? "Defeated" : "Draw";
};

interface PlayerPanelProps {
  slot: PlayerSlot;
  match: MatchStateDto;
  bombArmed: boolean;
  canAct: boolean;
  canBomb: boolean;
  scoreDeficit: number;
  onToggleBomb: () => void;
}

const getTurnBoxText = ({
  slot,
  match,
  bombArmed,
  canBomb,
  scoreDeficit
}: PlayerPanelProps): string => {
  if (match.phase === "finished") {
    return getFinishedText(slot, match);
  }

  if (slot.isSelf) {
    return getSelfTurnText(slot, { bombArmed, canBomb, scoreDeficit });
  }

  return slot.isTurn ? `${slot.title} is moving.` : `${slot.title} is waiting.`;
};

export const PlayerPanel = (props: PlayerPanelProps) => {
  const { slot, bombArmed, canAct, canBomb, onToggleBomb } = props;
  const bombState: BombState = { bombArmed, isReady: slot.isSelf && canAct && canBomb };

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
      {/*
        Bomb availability is easy to miss, so give the active player a distinct
        ready state instead of relying on the disabled button contrast alone.
      */}
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
          type="button"
          aria-label={getBombLabel(slot, bombState)}
          className={[
            "sidebar-pill",
            "sidebar-bomb-pill",
            bombState.isReady ? "is-ready" : "",
            slot.isSelf && bombArmed ? "is-armed" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={slot.isSelf ? onToggleBomb : undefined}
          disabled={!slot.isSelf || !canAct || !canBomb}
          title={
            bombState.isReady
              ? "Bomb ready: click to arm a 5x5 blast."
              : `Bomb: one use only, and only while trailing by ${MIN_BOMB_DEFICIT} or more.`
          }
        >
          <BombIcon
            className="sidebar-bomb-icon"
            variant={getBombVariant(slot, bombState)}
            size={19}
          />
        </button>
      </div>

      <div className="sidebar-turn-box">
        <p>{getTurnBoxText(props)}</p>
      </div>
    </section>
  );
};
