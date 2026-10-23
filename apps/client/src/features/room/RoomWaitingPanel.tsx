import "./room-waiting.css";

import type { GameClientSnapshot } from "../../app/providers/game-client.store.js";
import { LobbyLayout } from "../../shared-ui/LobbyLayout.js";
import { buildInvitePath } from "./invite-link.js";

type RoomSession = NonNullable<GameClientSnapshot["session"]>;

export interface InviteNotice {
  message: string;
  failed: boolean;
}

const InviteNoticeLine = ({ notice }: { notice: InviteNotice }) =>
  notice.failed ? (
    <p className="arcade-flow-error" role="alert">
      {notice.message}
    </p>
  ) : (
    <p className="room-waiting-notice" role="status">
      {notice.message}
    </p>
  );

interface RoomWaitingPanelProps {
  roomCode: string;
  connectionStatus: string;
  session: RoomSession;
  inviteNotice: InviteNotice | null;
  error: string | null;
  onCopy: (value: string, successMessage: string) => void;
  onCancelRoom: () => void;
  onHome: () => void;
  cancelPending: boolean;
}

export const RoomWaitingPanel = ({
  roomCode,
  connectionStatus,
  session,
  inviteNotice,
  error,
  onCopy,
  onCancelRoom,
  onHome,
  cancelPending
}: RoomWaitingPanelProps) => {
  const host = session.players[0];
  const opponent = session.players[1];
  const inviteToken = session.inviteToken ?? null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inviteLink = inviteToken ? `${origin}${buildInvitePath(inviteToken)}` : null;

  return (
    <LobbyLayout
      connectionStatus={connectionStatus}
      onHome={onHome}
      stage={
        <div className="solo-stage-status" role="status">
          <span className="arcade-room-code">Room {roomCode}</span>
          <span>{opponent ? "Your friend joined." : "Waiting for your friend…"}</span>
        </div>
      }
    >
      <section className="solo-entry-card room-waiting-card" aria-labelledby="room-ready-heading">
        <div className="room-waiting-intro">
          <h2 id="room-ready-heading">Your room is ready.</h2>
          <p>Share the link. Play when your friend joins.</p>
        </div>
        <div className="arcade-people">
          <div className="arcade-seat">
            <strong title={host?.displayName ?? session.displayName}>
              {host?.displayName ?? session.displayName}
            </strong>
            <span>Host · Ready</span>
          </div>
          <div className={`arcade-seat${opponent ? "" : " is-open"}`}>
            <strong title={opponent?.displayName ?? "Your friend"}>
              {opponent?.displayName ?? "Your friend"}
            </strong>
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
          Copy invite link
        </button>
        {inviteNotice ? <InviteNoticeLine notice={inviteNotice} /> : null}
        <div className="room-waiting-meta">
          <span>Room {roomCode}</span>
          <details className="arcade-token-details">
            <summary>Copy a token instead</summary>
            <div className="room-waiting-token-expanded">
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
                Copy invite token
              </button>
            </div>
          </details>
        </div>
        {error ? (
          <p className="arcade-flow-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="arcade-back room-waiting-back"
          disabled={cancelPending}
          onClick={onCancelRoom}
        >
          {cancelPending ? "Cancelling room…" : "Cancel room and return"}
        </button>
      </section>
    </LobbyLayout>
  );
};
