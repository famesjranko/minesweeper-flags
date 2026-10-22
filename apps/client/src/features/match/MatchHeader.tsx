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
}

export const MatchHeader = ({ roomCode, connectionStatus, match }: MatchHeaderProps) => (
  <>
    <ArcadeHeader connectionStatus={connectionStatus} roomCode={roomCode}>
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
          <a href="/lobby">Back to lobby</a>
        </div>
      </details>
    </ArcadeHeader>
    {connectionStatus !== "connected" ? (
      <p className="arcade-match-connection" role="status">
        {connectionStatus === "connecting"
          ? "Reconnecting to the game…"
          : "Connection lost. Reconnecting…"}
      </p>
    ) : null}
  </>
);
