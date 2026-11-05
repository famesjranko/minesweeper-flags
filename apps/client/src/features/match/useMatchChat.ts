import { useEffect, useRef } from "react";

export const useMatchChat = () => {
  const chatRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = chatRef.current;
    if (!dialog) return;

    const sidebar = window.matchMedia("(min-width: 900px)");
    const syncLayout = () => {
      // A modal traps focus on small screens. A non-modal dialog stays beside the board.
      dialog.close();
      if (sidebar.matches) dialog.open = true;
    };
    syncLayout();
    sidebar.addEventListener("change", syncLayout);
    return () => sidebar.removeEventListener("change", syncLayout);
  }, []);

  return chatRef;
};
