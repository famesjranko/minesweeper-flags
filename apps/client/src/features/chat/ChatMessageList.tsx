import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { useEffect, useRef } from "react";

interface ChatMessageListProps {
  currentPlayerId: string;
  playerTones: Record<string, "blue" | "red">;
  messages: ChatMessageDto[];
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

const EMOTICON_SYMBOLS: Record<string, string> = {
  ":)": "🙂",
  ":-)": "🙂",
  ":(": "☹",
  ":-(": "☹",
  ":D": "😄",
  ":-D": "😄",
  ";)": "😉",
  ";-)": "😉",
  ":P": "😛",
  ":-P": "😛",
  "<3": "❤"
};

const renderChatText = (text: string) =>
  text.split(/(\s+)/).map((part, index) => {
    const emoticon = EMOTICON_SYMBOLS[part];

    if (!emoticon) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    return (
      <span key={`${part}-${index}`} className="chat-emoticon" title={part}>
        {emoticon}
      </span>
    );
  });

export const ChatMessageList = ({
  currentPlayerId,
  playerTones,
  messages
}: ChatMessageListProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;

    if (!list) {
      return;
    }

    const handleScroll = () => {
      shouldStickToBottomRef.current =
        list.scrollHeight - list.scrollTop - list.clientHeight < 28;
    };

    handleScroll();
    list.addEventListener("scroll", handleScroll);

    return () => {
      list.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;

    if (!list || !shouldStickToBottomRef.current) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="chat-empty-state">
        <p>No messages yet.</p>
        <p>Start the conversation.</p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="chat-message-list" role="log" aria-live="polite">
      {messages.map((message) => {
        const isSelf = message.playerId === currentPlayerId;
        const playerTone = playerTones[message.playerId] ?? "blue";

        return (
          <article
            key={message.messageId}
            className={[
              "chat-message",
              isSelf ? "is-self" : "is-opponent",
              `is-${playerTone}-player`
            ].join(" ")}
          >
            <header className="chat-message-meta">
              <strong>{isSelf ? "You" : message.displayName}</strong>
              <time dateTime={new Date(message.sentAt).toISOString()}>
                {timeFormatter.format(message.sentAt)}
              </time>
            </header>
            <p className="chat-message-text">{renderChatText(message.text)}</p>
          </article>
        );
      })}
    </div>
  );
};
