import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { useChatScroll } from "./useChatScroll.js";

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
      // biome-ignore lint/suspicious/noArrayIndexKey: words repeat, and the list is rebuilt from the text on each render.
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: words repeat, and the list is rebuilt from the text on each render.
      <span key={`${part}-${index}`} className="chat-emoticon" title={part}>
        {emoticon}
      </span>
    );
  });

const groupMessages = (messages: ChatMessageDto[]) => {
  const groups: ChatMessageDto[][] = [];
  for (const message of messages) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const elapsed = previous ? message.sentAt - previous.sentAt : 0;
    if (!previous || previous.playerId !== message.playerId || elapsed < 0 || elapsed > 300_000) {
      groups.push([message]);
    } else {
      group!.push(message);
    }
  }
  return groups;
};

const ChatMessageGroup = ({ messages, currentPlayerId, playerTones }: ChatMessageListProps) => {
  const first = messages[0]!;
  const isSelf = first.playerId === currentPlayerId;
  const sender = isSelf ? "You" : first.displayName;
  const playerTone = playerTones[first.playerId] ?? "blue";

  return (
    <div
      className={[
        "chat-message-group",
        isSelf ? "is-self" : "is-opponent",
        `is-${playerTone}-player`
      ].join(" ")}
    >
      <header className="chat-message-meta">
        <strong>{sender}</strong>
        <time dateTime={new Date(first.sentAt).toISOString()}>
          {timeFormatter.format(first.sentAt)}
        </time>
      </header>
      {messages.map((message) => (
        <article
          key={message.messageId}
          className="chat-message"
          aria-label={`${sender}, ${timeFormatter.format(message.sentAt)}`}
        >
          <p className="chat-message-text">{renderChatText(message.text)}</p>
        </article>
      ))}
    </div>
  );
};

export const ChatMessageList = ({
  currentPlayerId,
  playerTones,
  messages
}: ChatMessageListProps) => {
  const { listRef, onScroll } = useChatScroll(messages);

  if (messages.length === 0) {
    return (
      <div className="chat-empty-state">
        <p>No messages yet.</p>
        <p>Start the conversation.</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      className="chat-message-list"
      role="log"
      aria-live="polite"
    >
      {groupMessages(messages).map((group) => (
        <ChatMessageGroup
          key={group[0]!.messageId}
          messages={group}
          currentPlayerId={currentPlayerId}
          playerTones={playerTones}
        />
      ))}
    </div>
  );
};
