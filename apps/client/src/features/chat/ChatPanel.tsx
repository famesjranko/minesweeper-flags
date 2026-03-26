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
  onDraftChange: (value: string) => void;
  onSend: () => void;
}

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
  onDraftChange,
  onSend
}: ChatPanelProps) => {
  const sendDisabled = connectionStatus !== "connected" || pending || !draft.trim();
  const statusMessage = error
    ? error
    : pending
      ? "Sending..."
      : connectionStatus !== "connected"
        ? "Chat reconnecting. You can keep typing."
        : helperText ?? "Press Enter to send.";

  return (
    <section className={["classic-chat-frame", className].filter(Boolean).join(" ")}>
      <header className="chat-panel-header">
        <div>
          <h2>Messenger</h2>
          <span>Room {roomCode}</span>
        </div>
        <span className={`chat-connection-pill is-${connectionStatus}`}>{connectionStatus}</span>
      </header>

      <ChatMessageList
        currentPlayerId={currentPlayerId}
        playerTones={playerTones}
        messages={messages}
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
          value={draft}
          disabled={pending}
          placeholder="Type a message..."
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <button type="submit" disabled={sendDisabled}>
          Send
        </button>
      </form>

      <p className={["chat-inline-status", error ? "is-error" : ""].filter(Boolean).join(" ")}>
        {statusMessage}
      </p>
    </section>
  );
};
