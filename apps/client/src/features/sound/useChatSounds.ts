import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { useEffect, useRef } from "react";
import { getSoundPlayer, type SoundPlayer } from "./sound-player.js";
import { isSoundEnabled } from "./sound-settings.js";

/** Sounds new chat messages in a live match; history and non-live phases stay silent. */
export const useChatSounds = (
  messages: readonly ChatMessageDto[],
  viewerPlayerId: string,
  live: boolean,
  player: SoundPlayer = getSoundPlayer()
): void => {
  // null until the first run, which only records the history.
  const seenRef = useRef<Set<string> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only new messages or a phase change should sound
  useEffect(() => {
    const isHistory = seenRef.current === null;
    const seen = seenRef.current ?? new Set<string>();
    seenRef.current = seen;
    const unseen = messages.filter((message) => !seen.has(message.messageId));
    for (const message of unseen) {
      seen.add(message.messageId);
    }
    const newest = unseen.at(-1);
    if (isHistory || !newest || !live || !isSoundEnabled()) {
      return;
    }
    player.play(newest.playerId === viewerPlayerId ? "chat-sent" : "chat-received");
  }, [messages, live]);
};
