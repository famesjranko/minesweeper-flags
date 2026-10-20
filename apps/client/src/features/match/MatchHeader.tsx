import type { MatchStateDto } from "@minesweeper-flags/shared";
import { ArcadeHeader } from "../../shared-ui/ArcadeHeader.js";

const ResignButton = ({ disabled, onResign }: { disabled: boolean; onResign: () => void }) => (
  <button
    type="button"
    className="sidebar-resign-button"
    disabled={disabled}
    onClick={() => {
      if (window.confirm("Resign this match?")) {
        onResign();
      }
    }}
  >
    RESIGN
  </button>
);

interface MatchHeaderProps {
  roomCode: string;
  connectionStatus: string;
  match: MatchStateDto;
  onResign: () => void;
}

export const MatchHeader = ({ roomCode, connectionStatus, match, onResign }: MatchHeaderProps) => (
  <>
    <ArcadeHeader connectionStatus={connectionStatus} roomCode={roomCode}>
      <details
        className="arcade-match-options"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.open = false;
        }}
      >
        <summary aria-label="Match options">•••</summary>
        <div className="arcade-options-menu">
          <p>
            Room {roomCode} · Turn {match.turnNumber}
          </p>
          <p>Claim mines to score. First to 26 wins.</p>
          <p>
            Bombs remaining · Blue {match.players[0].bombsRemaining} · Red{" "}
            {match.players[1].bombsRemaining}
          </p>
          <ResignButton disabled={match.phase !== "live"} onResign={onResign} />
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
