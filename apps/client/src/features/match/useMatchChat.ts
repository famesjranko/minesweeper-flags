import { useEffect, useRef } from "react";

export const useMatchChat = () => {
  const chatRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = chatRef.current;
    if (!dialog) return;

    const compact = window.matchMedia("(max-width: 1000px), (max-height: 500px)");
    const syncLayout = () => {
      // A modal traps focus on small screens. A non-modal dialog stays beside the board.
      dialog.close();
      if (!compact.matches) dialog.open = true;
    };
    syncLayout();
    compact.addEventListener("change", syncLayout);
    return () => compact.removeEventListener("change", syncLayout);
  }, []);

  return chatRef;
};
