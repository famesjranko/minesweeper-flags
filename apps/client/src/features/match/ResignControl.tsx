import { type KeyboardEvent, useRef, useState } from "react";

interface ResignControlProps {
  disabled: boolean | undefined;
  onResign: () => void;
}

export const ResignControl = ({ disabled, onResign }: ResignControlProps) => {
  // The opponent's moves do not change whether the player wants to resign, so a pending
  // confirmation survives them (the bot can claim several mines in a row). The play area
  // replaces this control when the match ends, which discards the confirmation.
  const [confirming, setConfirming] = useState(false);
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
    setConfirming(true);
  };
  const keepPlaying = () => {
    pendingFocus.current = "resign";
    setConfirming(false);
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
