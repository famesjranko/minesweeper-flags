import { Link } from "react-router-dom";
import type { GameClientSnapshot } from "../../app/providers/game-client.store.js";
import { ArcadePage } from "../../shared-ui/ArcadePage.js";
import { buildInvitePath } from "./invite-link.js";

type RoomSession = NonNullable<GameClientSnapshot["session"]>;

interface RoomWaitingPanelProps {
  roomCode: string;
  connectionStatus: string;
  session: RoomSession;
  inviteNotice: string | null;
  error: string | null;
  onCopy: (value: string, successMessage: string) => void;
}

export const RoomWaitingPanel = ({
  roomCode,
  connectionStatus,
  session,
  inviteNotice,
  error,
  onCopy
}: RoomWaitingPanelProps) => {
  const host = session.players[0];
  const opponent = session.players[1];
  const inviteToken = session.inviteToken ?? null;
  const inviteLink = inviteToken
    ? typeof window !== "undefined"
      ? `${window.location.origin}${buildInvitePath(inviteToken)}`
      : buildInvitePath(inviteToken)
    : null;

  return (
    <ArcadePage connectionStatus={connectionStatus}>
      <section className="arcade-flow">
        <div className="arcade-flow-intro">
          <p className="arcade-flow-eyebrow">Private match</p>
          <h1>Your room is ready.</h1>
          <p>Send a friend the invite link. The game starts when they join.</p>
        </div>
        <div className="arcade-flow-card">
          <div className="arcade-people">
            <div className="arcade-seat">
              <strong title={host?.displayName ?? session.displayName}>
                {host?.displayName ?? session.displayName}
              </strong>
              <span>Host · Ready</span>
            </div>
            <div className={`arcade-seat${opponent ? "" : " is-open"}`}>
              <strong>{opponent?.displayName ?? "Your friend"}</strong>
              <span>{opponent ? "Guest · Connected" : "Waiting to join"}</span>
            </div>
          </div>
          <div className="arcade-field">
            <span>Private invite link</span>
            <div className="arcade-invite-value">{inviteLink ?? "Unavailable"}</div>
          </div>
          <button
            type="button"
            className="arcade-primary"
            disabled={!inviteLink}
            onClick={() => (inviteLink ? onCopy(inviteLink, "Invite link copied.") : undefined)}
          >
            Copy Invite Link
          </button>
          <div className="arcade-flow-status" role="status">
            <span>
              {inviteNotice ?? (opponent ? "Guest connected." : "Waiting for player two.")}
            </span>
            <span>Room {roomCode}</span>
          </div>
          <details className="arcade-token-details">
            <summary>Copy a token instead</summary>
            <div className="arcade-field">
              <span>Invite token</span>
              <div className="arcade-invite-value invite-token-readonly">
                {inviteToken ?? "Unavailable"}
              </div>
            </div>
            <button
              type="button"
              className="arcade-secondary"
              disabled={!inviteToken}
              onClick={() =>
                inviteToken ? onCopy(inviteToken, "Invite token copied.") : undefined
              }
            >
              Copy Invite Token
            </button>
          </details>
          {error ? (
            <p className="arcade-flow-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <Link className="arcade-back" to="/lobby">
          ← Back To Lobby
        </Link>
      </section>
    </ArcadePage>
  );
};
