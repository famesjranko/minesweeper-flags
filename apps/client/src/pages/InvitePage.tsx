import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { LobbyPreviewPanel } from "../features/room/LobbyPreviewPanel.js";

export const InvitePage = () => {
  const { roomCode = "" } = useParams();
  const normalizedRoomCode = roomCode.toUpperCase();
  const { connectionStatus, error, session, joinRoom } = useGameClient();
  const [displayName, setDisplayName] = useState("Captain Sweeper");

  if (!normalizedRoomCode) {
    return <Navigate to="/lobby" replace />;
  }

  if (session?.roomCode === normalizedRoomCode) {
    return <Navigate to={`/room/${normalizedRoomCode}`} replace />;
  }

  const trimmedDisplayName = displayName.trim();
  const canJoin = trimmedDisplayName.length > 0;

  return (
    <main className="page-shell home-page-shell">
      <section className="panel hero-panel lobby-panel invite-panel">
        <div className="hero-copy invite-hero-copy">
          <p className="eyebrow">Live room invitation</p>
          <h1>Join Minesweeper Flags</h1>
          <div className="invite-room-banner">
            <span className="invite-room-banner-label">Room code</span>
            <strong>{normalizedRoomCode}</strong>
          </div>
          <p>
            Someone shared a live match with you. Pick a display name and use this
            invite link to join the room immediately.
          </p>
        </div>

        <div className="lobby-stage invite-stage">
          <LobbyPreviewPanel
            title="Incoming match"
            badge="invite"
            featurePills={[
              `Room ${normalizedRoomCode}`,
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

              <div className="invite-room-readout">
                <span className="invite-room-readout-label">Invite code</span>
                <strong>{normalizedRoomCode}</strong>
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

                if (!canJoin) {
                  return;
                }

                joinRoom(trimmedDisplayName, normalizedRoomCode);
              }}
            >
              <div className="lobby-card-heading">
                <h2>Join Game</h2>
                <span>This invite link already filled the room code.</span>
              </div>

              <p className="invite-info-copy">
                You will enter room {normalizedRoomCode} and the match starts as soon as
                both players are connected.
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
          <span className="lobby-status-note">
            Invite code {normalizedRoomCode} is loaded for this tab.
          </span>
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
