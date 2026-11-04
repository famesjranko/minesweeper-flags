import type { MatchStateDto } from "@minesweeper-flags/shared";
import { ArcadeHeader } from "../../shared-ui/ArcadeHeader.js";

const closeOptions = (details: HTMLDetailsElement) => {
  details.open = false;
  details.querySelector("summary")?.focus();
};

interface MatchHeaderProps {
  roomCode: string;
  connectionStatus: string;
  match: MatchStateDto;
  opponentOffline: boolean;
  unreadChat: number;
  onOpenChat: () => void;
  /** Leaves without a page load, so the lobby can offer the way back into this match. */
  onBackToLobby?: (() => void) | undefined;
}

export const MatchHeader = ({
  roomCode,
  connectionStatus,
  match,
  opponentOffline,
  unreadChat,
  onOpenChat,
  onBackToLobby
}: MatchHeaderProps) => (
  <>
    <ArcadeHeader
      connectionStatus={
        connectionStatus === "disconnected" && opponentOffline ? undefined : connectionStatus
      }
      roomCode={roomCode}
      onHome={onBackToLobby}
    >
      {unreadChat > 0 ? (
        <button
          type="button"
          className="arcade-chat-chip"
          aria-haspopup="dialog"
          aria-label={`Open chat, ${unreadChat} new ${unreadChat === 1 ? "message" : "messages"}`}
          onClick={onOpenChat}
        >
          <span className="arcade-chat-chip-dot" />
          Chat · {unreadChat}
        </button>
      ) : null}
      <details
        className="arcade-match-options"
        onKeyDown={(event) => {
          if (event.key === "Escape") closeOptions(event.currentTarget);
        }}
      >
        <summary aria-label="Match options">•••</summary>
        <div className="arcade-options-menu">
          <div className="arcade-options-heading">
            <strong>Match options</strong>
            <button
              type="button"
              className="arcade-options-close"
              aria-label="Close match options"
              onClick={(event) => {
                const details = event.currentTarget.closest("details");
                if (details) closeOptions(details);
              }}
            >
              ×
            </button>
          </div>
          <p className="arcade-options-room">
            Room {roomCode} · Turn {match.turnNumber}
          </p>
          <p>Claim mines to score. First to 26 wins.</p>
          <div className="arcade-options-bombs">
            <span>
              Blue · {match.players[0].bombsRemaining}{" "}
              {match.players[0].bombsRemaining === 1 ? "bomb" : "bombs"}
            </span>
            <span>
              Red · {match.players[1].bombsRemaining}{" "}
              {match.players[1].bombsRemaining === 1 ? "bomb" : "bombs"}
            </span>
          </div>
          <a
            href="/lobby"
            onClick={
              onBackToLobby
                ? (event) => {
                    event.preventDefault();
                    onBackToLobby();
                  }
                : undefined
            }
          >
            Back to lobby
          </a>
        </div>
      </details>
    </ArcadeHeader>
  </>
);
