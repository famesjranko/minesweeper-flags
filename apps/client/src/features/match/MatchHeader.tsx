import type { MatchStateDto } from "@minesweeper-flags/shared";
import { ArcadeHeader } from "../../shared-ui/ArcadeHeader.js";
import { GameHelp } from "../../shared-ui/GameHelp.js";

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
      <button
        type="button"
        className={unreadChat > 0 ? "arcade-chat-chip" : "arcade-chat-open"}
        aria-haspopup="dialog"
        aria-label={
          unreadChat > 0
            ? `Open chat, ${unreadChat} new ${unreadChat === 1 ? "message" : "messages"}`
            : "Open chat"
        }
        onClick={onOpenChat}
      >
        {unreadChat > 0 ? <span className="arcade-chat-chip-dot" /> : null}
        {unreadChat > 0 ? `Chat · ${unreadChat}` : "Chat"}
      </button>
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
          <GameHelp mineCount={match.board.mineCount} />
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
