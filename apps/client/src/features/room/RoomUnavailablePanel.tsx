import { Link } from "react-router-dom";
import { ArcadePage } from "../../shared-ui/ArcadePage.js";

const isDisplacedError = (error: string | null): boolean =>
  error?.includes("active in another tab or window") ?? false;

const isRecoveryUnavailableError = (error: string | null): boolean =>
  error?.includes("recovery is no longer available") ?? false;

const isClaimVictoryError = (error: string | null): boolean =>
  error !== null &&
  (error.includes("now have control") || error.includes("now have an active claim"));

const ConflictGuidance = ({ error }: { error: string | null }) => (
  <div className="arcade-notice">
    <p className="arcade-flow-note">{error}</p>
    {isDisplacedError(error) && (
      <p className="arcade-flow-note">
        Another tab has claimed control. Close other tabs for this room, or reconnect to reclaim
        control.
      </p>
    )}
    {isRecoveryUnavailableError(error) && (
      <p className="arcade-flow-note">
        Recovery data was cleared. You can start a fresh direct match from the lobby.
      </p>
    )}
  </div>
);

const getHeading = (waitingForHost: boolean, canReconnect: boolean): string => {
  if (waitingForHost) return "Waiting for the host to return.";
  return canReconnect ? "Reconnect to your game." : "Room unavailable";
};

interface RoomUnavailablePanelProps {
  roomCode: string;
  error: string | null;
  isP2PDeployment: boolean;
  canReconnect: boolean;
  /** A direct-match guest keeps retrying on its own until the host's tab returns. */
  waitingForHost: boolean;
  onReconnect: () => void;
}

export const RoomUnavailablePanel = ({
  roomCode,
  error,
  isP2PDeployment,
  canReconnect,
  waitingForHost,
  onReconnect
}: RoomUnavailablePanelProps) => {
  const showConflictGuidance = isDisplacedError(error) || isRecoveryUnavailableError(error);
  const showClaimVictory = isClaimVictoryError(error);
  const offerReconnect = canReconnect && !showClaimVictory;
  const fallbackMessage = isP2PDeployment
    ? canReconnect
      ? "Direct Match is reconnecting. If recovery does not finish, start a new match from the lobby."
      : "This direct match closed. Start a new one from the lobby."
    : "Create or join the room from the home page first.";

  return (
    <ArcadePage>
      <section className="arcade-flow is-error">
        <div className="arcade-flow-intro">
          <p className="arcade-flow-eyebrow">Room {roomCode}</p>
          <h1>{getHeading(waitingForHost, offerReconnect)}</h1>
          {waitingForHost ? (
            <p>The host’s tab closed or lost its connection. You’ll rejoin when they come back.</p>
          ) : (
            <p>
              This browser is not currently attached to room <strong>{roomCode}</strong>.
            </p>
          )}
        </div>
        <div className="arcade-flow-card">
          {showConflictGuidance && <ConflictGuidance error={error} />}
          {showClaimVictory && <p className="arcade-notice">{error}</p>}
          {!showConflictGuidance && !showClaimVictory && !waitingForHost && (
            <p>{error ?? fallbackMessage}</p>
          )}
          <div className={`arcade-flow-actions${offerReconnect ? "" : " is-single"}`}>
            {offerReconnect ? (
              <button type="button" className="arcade-primary" onClick={onReconnect}>
                Reconnect
              </button>
            ) : null}
            <Link className={offerReconnect ? "arcade-secondary" : "arcade-primary"} to="/lobby">
              Back to lobby
            </Link>
          </div>
        </div>
      </section>
    </ArcadePage>
  );
};
