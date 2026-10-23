import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { ChatMessageList } from "./ChatMessageList.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected";
type PlayerTone = "blue" | "red";

interface ChatPanelProps {
  roomCode: string;
  currentPlayerId: string;
  playerTones: Record<string, PlayerTone>;
  connectionStatus: ConnectionStatus;
  messages: ChatMessageDto[];
  draft: string;
  pending: boolean;
  error: string | null;
  helperText?: string;
  className?: string;
  onClose?: () => void;
  onExpand?: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}

const getStatusMessage = ({
  error,
  pending,
  connectionStatus,
  helperText
}: {
  error: string | null;
  pending: boolean;
  connectionStatus: ConnectionStatus;
  helperText: string | undefined;
}) => {
  if (error) return error;
  if (pending) return "Sending...";
  if (connectionStatus !== "connected") return "Chat offline. You can keep typing.";
  return helperText ?? "Press Enter to send.";
};

export const ChatPanel = ({
  roomCode,
  currentPlayerId,
  playerTones,
  connectionStatus,
  messages,
  draft,
  pending,
  error,
  helperText,
  className,
  onClose,
  onExpand,
  onDraftChange,
  onSend
}: ChatPanelProps) => {
  const sendDisabled = connectionStatus !== "connected" || pending || !draft.trim();
  const statusMessage = getStatusMessage({ error, pending, connectionStatus, helperText });

  return (
    <section className={["classic-chat-frame", className].filter(Boolean).join(" ")}>
      <header className="chat-panel-header">
        <div>
          <h2>Chat</h2>
          {!onExpand ? (
            <p className="chat-room-meta">
              Room {roomCode}{" "}
              <span className={`chat-connection-pill is-${connectionStatus}`}>
                · {connectionStatus}
              </span>
            </p>
          ) : null}
        </div>
        {onExpand ? (
          <button type="button" className="chat-expand" aria-haspopup="dialog" onClick={onExpand}>
            Full chat ↗
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            className="arcade-chat-close"
            aria-label="Close chat"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </header>

      <ChatMessageList
        currentPlayerId={currentPlayerId}
        playerTones={playerTones}
        messages={onExpand ? messages.slice(-2) : messages}
      />

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();

          if (!sendDisabled) {
            onSend();
          }
        }}
      >
        <input
          aria-label="Chat message"
          value={draft}
          disabled={pending}
          placeholder="Type a message..."
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <button type="submit" disabled={sendDisabled}>
          Send
        </button>
      </form>

      {!onExpand || error || pending || connectionStatus !== "connected" ? (
        <p className={["chat-inline-status", error ? "is-error" : ""].filter(Boolean).join(" ")}>
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
};
