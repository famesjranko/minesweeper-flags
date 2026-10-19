import { Link } from "react-router-dom";

const isDisplacedError = (error: string | null): boolean =>
  error?.includes("active in another tab or window") ?? false;

const isRecoveryUnavailableError = (error: string | null): boolean =>
  error?.includes("recovery is no longer available") ?? false;

const isClaimVictoryError = (error: string | null): boolean =>
  error !== null &&
  (error.includes("now have control") || error.includes("now have an active claim"));

const ConflictGuidance = ({ error }: { error: string | null }) => (
  <div className="conflict-guidance">
    <p className="conflict-message">{error}</p>
    {isDisplacedError(error) && (
      <p className="conflict-action">
        Another tab has claimed control. Close other tabs for this room, or reconnect to reclaim
        control.
      </p>
    )}
    {isRecoveryUnavailableError(error) && (
      <p className="conflict-action">
        Recovery data was cleared. You can start a fresh direct match from the lobby.
      </p>
    )}
  </div>
);

interface RoomUnavailablePanelProps {
  roomCode: string;
  error: string | null;
  isP2PDeployment: boolean;
  canReconnect: boolean;
  onReconnect: () => void;
}

export const RoomUnavailablePanel = ({
  roomCode,
  error,
  isP2PDeployment,
  canReconnect,
  onReconnect
}: RoomUnavailablePanelProps) => {
  const showConflictGuidance = isDisplacedError(error) || isRecoveryUnavailableError(error);
  const showClaimVictory = isClaimVictoryError(error);
  const fallbackMessage = isP2PDeployment
    ? "Direct Match is reconnecting. If recovery does not finish, start a new match from the lobby."
    : "Create or join the room from the home page first.";

  return (
    <main className="page-shell room-page-shell">
      <section className="panel waiting-panel room-unavailable-panel">
        <h1>Room unavailable</h1>
        <p>
          This browser is not currently attached to room <strong>{roomCode}</strong>.
        </p>
        {showConflictGuidance && <ConflictGuidance error={error} />}
        {showClaimVictory && (
          <div className="claim-victory-notice">
            <p>{error}</p>
          </div>
        )}
        {!showConflictGuidance && !showClaimVictory && <p>{error ?? fallbackMessage}</p>}
        <div className="waiting-action-row">
          {canReconnect && !showClaimVictory && (
            <button type="button" className="primary-button" onClick={onReconnect}>
              Reconnect
            </button>
          )}
          <Link className="primary-button link-button" to="/lobby">
            Go To Lobby
          </Link>
        </div>
      </section>
    </main>
  );
};
