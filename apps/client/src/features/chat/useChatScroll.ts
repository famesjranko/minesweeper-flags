import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { useLayoutEffect, useRef } from "react";

export const useChatScroll = (messages: readonly ChatMessageDto[]) => {
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const hasMessages = messages.length > 0;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!hasMessages || !list) return;

    // Closed dialogs have no layout. Observe the list so opening chat or changing
    // its available height follows the conversation without needing a new message.
    const observer = new ResizeObserver(() => {
      if (following.current && list.clientHeight > 0) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasMessages]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll after each message update, before the browser paints.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && following.current && list.clientHeight > 0) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const list = listRef.current;
    if (list && list.clientHeight > 0) {
      following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 28;
    }
  };

  return { listRef, onScroll };
};
