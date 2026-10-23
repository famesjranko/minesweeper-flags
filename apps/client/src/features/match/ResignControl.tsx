import type { MatchStateDto } from "@minesweeper-flags/shared";
import { type KeyboardEvent, useRef, useState } from "react";

interface ResignControlProps {
  match: MatchStateDto;
  disabled: boolean | undefined;
  onResign: () => void;
}

// Every move either passes the turn or scores a mine, so this key changes with each move.
const moveKey = (match: MatchStateDto) =>
  `${match.phase}:${match.turnNumber}:${match.players.map((player) => player.score).join(",")}`;

export const ResignControl = ({ match, disabled, onResign }: ResignControlProps) => {
  const key = moveKey(match);
  // A confirmation belongs to the position it was asked in; any later move cancels it.
  const [confirmingAt, setConfirmingAt] = useState<string | null>(null);
  const confirming = confirmingAt === key;
  // Swapping the buttons would drop keyboard focus, so the button that appears takes it.
  const pendingFocus = useRef<"keep" | "resign" | null>(null);
  const focusOnMount = (target: "keep" | "resign") => (element: HTMLButtonElement | null) => {
    if (element && pendingFocus.current === target) {
      pendingFocus.current = null;
      element.focus();
    }
  };

  const ask = () => {
    pendingFocus.current = "keep";
    setConfirmingAt(key);
  };
  const keepPlaying = () => {
    pendingFocus.current = "resign";
    setConfirmingAt(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    keepPlaying();
  };

  if (!confirming) {
    return (
      <button
        ref={focusOnMount("resign")}
        type="button"
        name="resign"
        className="match-resign-action"
        disabled={disabled}
        onClick={ask}
      >
        Resign match
      </button>
    );
  }
  return (
    <div className="match-resign-confirm">
      <button
        ref={focusOnMount("keep")}
        type="button"
        name="keep-playing"
        className="match-resign-action"
        onClick={keepPlaying}
        onKeyDown={onKeyDown}
      >
        Keep playing
      </button>
      <button
        type="button"
        name="confirm-resign"
        className="match-resign-action is-danger"
        disabled={disabled}
        onClick={onResign}
        onKeyDown={onKeyDown}
      >
        Confirm resign
      </button>
    </div>
  );
};
