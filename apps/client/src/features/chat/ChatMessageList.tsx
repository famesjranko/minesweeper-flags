import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { useChatScroll } from "./useChatScroll.js";

interface ChatMessageListProps {
  currentPlayerId: string;
  playerTones: Record<string, "blue" | "red">;
  messages: ChatMessageDto[];
  /** Shows only the latest messages. Earlier ones still count towards the groups. */
  limit?: number | undefined;
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

interface ChatMessageGroupProps extends Omit<ChatMessageListProps, "limit"> {
  /** How many of the group's first messages the limit has cut. */
  hiddenCount: number;
}

const ChatMessageGroup = ({
  messages,
  hiddenCount,
  currentPlayerId,
  playerTones
}: ChatMessageGroupProps) => {
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
      {messages.slice(hiddenCount).map((message) => (
        <article key={message.messageId} className="chat-message">
          <p className="chat-message-text">
            {/* A log announces added text, and a follow-up arrives without the group's header. */}
            {message === first ? null : (
              <span className="visually-hidden chat-message-sender">
                {sender}, {timeFormatter.format(message.sentAt)}:{" "}
              </span>
            )}
            {renderChatText(message.text)}
          </p>
        </article>
      ))}
    </div>
  );
};

export const ChatMessageList = ({
  currentPlayerId,
  playerTones,
  messages,
  limit = Number.POSITIVE_INFINITY
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

  // Group before applying the limit, so a group keeps its key as the window slides. A new key would
  // remount the group, and the log would announce its earlier messages again.
  const firstShown = messages.length - limit;
  let seen = 0;

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      className="chat-message-list"
      role="log"
      aria-live="polite"
    >
      {groupMessages(messages).map((group) => {
        const start = seen;
        seen += group.length;
        const hiddenCount = Math.max(0, firstShown - start);
        return hiddenCount < group.length ? (
          <ChatMessageGroup
            key={group[0]!.messageId}
            messages={group}
            hiddenCount={hiddenCount}
            currentPlayerId={currentPlayerId}
            playerTones={playerTones}
          />
        ) : null;
      })}
    </div>
  );
};
