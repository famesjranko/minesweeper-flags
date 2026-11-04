import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { useCallback, useState } from "react";

/** Counts the opponent's chat messages since the player last looked at the chat. */
export const useUnreadChat = (messages: readonly ChatMessageDto[], viewerPlayerId: string) => {
  const [mountedAt] = useState(() => Date.now());
  const [state, setState] = useState({ known: messages.length, unread: 0 });

  if (messages.length !== state.known) {
    // The first batch can be the history replay after a refresh, which the player has already had
    // the chance to read. Only messages written since this view opened count from it.
    const unseen = messages
      .slice(state.known)
      .filter((message) => message.playerId !== viewerPlayerId)
      .filter((message) => state.known > 0 || message.sentAt > mountedAt);
    setState({ known: messages.length, unread: state.unread + unseen.length });
  }

  const markRead = useCallback(() => {
    setState((current) => (current.unread === 0 ? current : { ...current, unread: 0 }));
  }, []);

  return { unread: state.unread, markRead };
};
