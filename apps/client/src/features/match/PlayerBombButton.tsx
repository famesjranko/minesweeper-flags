import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { BombIcon } from "../../shared-ui/BombIcon.js";
import type { PlayerSlot } from "./PlayerPanel.js";

interface PlayerBombButtonProps {
  slot: PlayerSlot;
  bombArmed: boolean;
  canAct: boolean;
  canBomb: boolean;
  finished: boolean;
  onToggleBomb: () => void;
}

const STATES = {
  locked: {
    title: "Bomb",
    detail: `Unlocks ${MIN_BOMB_DEFICIT} behind`,
    hint: `Bomb unused. It becomes available while trailing by ${MIN_BOMB_DEFICIT} or more on your turn.`
  },
  waiting: {
    title: "Bomb",
    detail: "Ready on your turn",
    hint: "Your bomb is ready. Wait for your turn to arm it."
  },
  ready: {
    title: "Arm bomb",
    detail: "Reveal a 5×5 area",
    hint: "Bomb ready: click to arm a 5x5 blast."
  },
  armed: {
    title: "Cancel bomb",
    detail: "Tap a centre square",
    hint: "Bomb armed. Pick the center of a 5x5 blast, or cancel targeting."
  },
  used: {
    title: "Bomb used",
    detail: "Once per match",
    hint: "Your bomb has already been used."
  },
  finished: {
    title: "Bomb",
    detail: "Match finished",
    hint: "Bomb unavailable. This match has finished."
  }
};

const getStatus = ({ slot, bombArmed, canAct, canBomb, finished }: PlayerBombButtonProps) => {
  if (slot.player.bombsRemaining === 0) return "used";
  if (finished) return "finished";
  if (!canBomb) return "locked";
  if (!canAct) return "waiting";
  return bombArmed ? "armed" : "ready";
};

export const PlayerBombButton = (props: PlayerBombButtonProps) => {
  const status = getStatus(props);
  const { title, detail, hint } = STATES[status];
  return (
    <button
      type="button"
      aria-label={hint}
      aria-pressed={status === "armed"}
      className={`sidebar-bomb-pill is-${status}`}
      onClick={props.onToggleBomb}
      disabled={status !== "ready" && status !== "armed"}
      title={hint}
    >
      <BombIcon className="sidebar-bomb-icon" spent={status === "used"} size={24} />
      <span className="arcade-tool-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
};
