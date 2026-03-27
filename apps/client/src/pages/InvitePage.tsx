import { inviteTokenSchema } from "@minesweeper-flags/shared";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { LobbyPreviewPanel } from "../features/room/LobbyPreviewPanel.js";

export const InvitePage = () => {
  const { inviteToken = "" } = useParams();
  const parsedInviteToken = inviteTokenSchema.safeParse(inviteToken.trim());
  const activeInviteToken = parsedInviteToken.success ? parsedInviteToken.data : null;
  const { connectionStatus, error, session, joinRoom, clearError } = useGameClient();
  const [displayName, setDisplayName] = useState("Captain Sweeper");

  useEffect(() => {
    clearError();
  }, [activeInviteToken]);

  if (session?.roomCode) {
    return <Navigate to={`/room/${session.roomCode}`} replace />;
  }

  const trimmedDisplayName = displayName.trim();
  const canJoin = trimmedDisplayName.length > 0 && activeInviteToken !== null;
  const inviteErrorState =
    activeInviteToken === null
      ? "invalid"
      : error === "That room is already full."
        ? "full"
        : error === "That invite link is no longer valid."
          ? "invalid"
          : null;

  if (inviteErrorState) {
    const title =
      inviteErrorState === "full" ? "Match already claimed" : "Invite unavailable";
    const message =
      inviteErrorState === "full"
        ? "Another player already filled this room. Ask the host for a fresh room if you still want to play."
        : activeInviteToken
          ? "This private invite link has expired or is no longer valid."
          : "This invite link is malformed or incomplete.";

    return (
      <main className="page-shell home-page-shell">
        <section className="panel hero-panel lobby-panel invite-panel invite-error-panel">
          <div className="hero-copy invite-hero-copy">
            <p className="eyebrow">Private invite</p>
            <h1>{title}</h1>
            <p>{message}</p>
          </div>

          <div className="waiting-action-row">
            <Link className="primary-button link-button" to="/lobby">
              Back To Lobby
            </Link>
          </div>

          <p className="waiting-room-note">
            Invite links are the only public join path now. Room codes are shown only after you enter the room.
          </p>
          {error && activeInviteToken ? <span className="error-text">{error}</span> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell home-page-shell">
      <section className="panel hero-panel lobby-panel invite-panel">
        <div className="hero-copy invite-hero-copy">
          <p className="eyebrow">Private room invitation</p>
          <h1>Join Minesweeper Flags</h1>
          <div className="invite-room-banner">
            <span className="invite-room-banner-label">Invite link loaded</span>
            <strong>Guest seat</strong>
          </div>
          <p>
            Someone shared a private match with you. Pick a display name and claim the
            open guest seat with this invite link.
          </p>
        </div>

        <div className="lobby-stage invite-stage">
          <LobbyPreviewPanel
            title="Incoming match"
            badge="invite"
            featurePills={[
              "Private invite link",
              "Shared 16x16 field",
              "First to 26 mines"
            ]}
          />

          <section className="lobby-control-panel invite-control-panel">
            <div className="lobby-identity-card invite-summary-card">
              <div className="lobby-card-heading">
                <h2>Join This Room</h2>
                <span className={`lobby-connection-pill is-${connectionStatus}`}>
                  {connectionStatus}
                </span>
              </div>

              <div className="invite-room-readout invite-private-readout">
                <span className="invite-room-readout-label">Access model</span>
                <strong>Token-based invite</strong>
              </div>

              <label className="field lobby-field">
                <span>Display name</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={20}
                  placeholder="Enter your display name"
                />
              </label>
            </div>

            <form
              className="lobby-action-card is-join invite-join-card"
              onSubmit={(event) => {
                event.preventDefault();

                if (!canJoin || !activeInviteToken) {
                  return;
                }

                joinRoom(trimmedDisplayName, activeInviteToken);
              }}
            >
              <div className="lobby-card-heading">
                <h2>Join Game</h2>
                <span>This link is the room's join credential.</span>
              </div>

              <p className="invite-info-copy">
                The match starts as soon as both players are connected. Room codes are shown after entry as a reference, not as a public join key.
              </p>

              <button
                className={[
                  "lobby-action-button",
                  "lobby-join-button",
                  canJoin ? "is-ready" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={!canJoin}
              >
                Join Game
              </button>

              <div className="invite-secondary-actions">
                <Link className="secondary-button link-button" to="/lobby">
                  Back To Lobby
                </Link>
              </div>
            </form>
          </section>
        </div>

        <div className="status-strip lobby-status-strip invite-status-strip">
          <span className="lobby-status-note">A private invite link is loaded for this tab.</span>
          {!canJoin ? (
            <span className="lobby-status-note">Pick a display name to unlock Join Game.</span>
          ) : (
            <span className="lobby-status-note">Ready to join. Press Join Game.</span>
          )}
          {error ? <span className="error-text">{error}</span> : null}
        </div>
      </section>
    </main>
  );
};
