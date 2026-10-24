import { BombIcon } from "../../shared-ui/BombIcon.js";
import type { PlayerSlot } from "./PlayerPanel.js";

interface PlayerBombButtonProps {
  slot: PlayerSlot;
  bombArmed: boolean;
  canAct: boolean;
  canBomb: boolean;
  bombDeficit: number;
  finished: boolean;
  onToggleBomb: () => void;
}

// The locked hint names the board's bomb deficit, so it is the one state built per render.
const lockedHint = (isSelf: boolean, deficit: number) =>
  isSelf
    ? `Bomb unused. It becomes available while trailing by ${deficit} or more on your turn.`
    : `Opponent bomb unused. Unlocks while trailing by ${deficit} or more.`;

const STATES = {
  waiting: "Your bomb is ready. Wait for your turn and connection to arm it.",
  ready: "Bomb ready: click to arm a 5x5 blast.",
  armed: "Bomb armed. Pick the center of a 5x5 blast, or cancel targeting.",
  used: "Your bomb has already been used.",
  finished: "Bomb unused. This match has finished."
};

const OPPONENT_STATES = {
  waiting: "Opponent bomb ready on their turn.",
  ready: "Opponent bomb available.",
  armed: "Opponent bomb available.",
  used: "Opponent bomb has already been used.",
  finished: "Opponent bomb unused. This match has finished."
};

const getStatus = ({ slot, bombArmed, canAct, canBomb, finished }: PlayerBombButtonProps) => {
  if (slot.player.bombsRemaining === 0) return "used";
  if (finished) return "finished";
  if (!canBomb) return "locked";
  if (!slot.isTurn || (slot.isSelf && !canAct)) return "waiting";
  return slot.isSelf && bombArmed ? "armed" : "ready";
};

export const PlayerBombButton = (props: PlayerBombButtonProps) => {
  const status = getStatus(props);
  const hint =
    status === "locked"
      ? lockedHint(props.slot.isSelf, props.bombDeficit)
      : (props.slot.isSelf ? STATES : OPPONENT_STATES)[status];
  const icon = <BombIcon className="sidebar-bomb-icon" spent={status === "used"} size={22} />;
  if (!props.slot.isSelf) {
    return (
      <span className={`inline-bomb is-${status}`} role="img" aria-label={hint} title={hint}>
        {icon}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={hint}
      aria-pressed={status === "armed"}
      className={`inline-bomb is-${status}`}
      onClick={props.onToggleBomb}
      disabled={status !== "ready" && status !== "armed"}
      title={hint}
    >
      {icon}
    </button>
  );
};
