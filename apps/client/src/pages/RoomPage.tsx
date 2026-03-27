import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { buildInvitePath } from "../features/room/invite-link.js";
import { LobbyPreviewPanel } from "../features/room/LobbyPreviewPanel.js";
import { MatchView } from "../features/match/MatchView.js";

export const RoomPage = () => {
  const { roomCode = "" } = useParams();
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const {
    connectionStatus,
    error,
    session,
    match,
    bombArmed,
    chatMessages,
    chatError,
    chatDraft,
    chatPending,
    hasStoredSession,
    reconnect,
    submitCellAction,
    setChatDraft,
    sendChatMessage,
    toggleBombMode,
    resignMatch,
    requestRematch,
    cancelRematch
  } = useGameClient();

  useEffect(() => {
    if (!roomCode) {
      return;
    }

    if ((!session || session.roomCode !== roomCode) && hasStoredSession(roomCode)) {
      reconnect(roomCode);
    }
  }, [hasStoredSession, reconnect, roomCode, session]);

  const inviteLink =
    session?.inviteToken
      ? typeof window === "undefined"
        ? buildInvitePath(session.inviteToken)
        : `${window.location.origin}${buildInvitePath(session.inviteToken)}`
      : null;

  const copyInviteValue = async (value: string, successMessage: string) => {
    try {
      await window.navigator.clipboard.writeText(value);
      setInviteNotice(successMessage);
    } catch {
      setInviteNotice("Copy failed. Copy it manually from the screen.");
    }
  };

  if (!roomCode) {
    return null;
  }

  if (!session || session.roomCode !== roomCode) {
    return (
      <main className="page-shell room-page-shell">
        <section className="panel waiting-panel room-unavailable-panel">
          <h1>Room unavailable</h1>
          <p>
            This browser is not currently attached to room <strong>{roomCode}</strong>.
          </p>
          <p>{error ?? "Create or join the room from the home page first."}</p>
          <div className="waiting-action-row">
            <Link className="primary-button link-button" to="/lobby">
              Go To Lobby
            </Link>
          </div>
          <p className="waiting-room-note">
            This page is only for a browser that already has a saved room session. Use the host's private invite link to join a room.
          </p>
        </section>
      </main>
    );
  }

  if (!match) {
    const host = session.players[0];
    const opponent = session.players[1];
    const inviteToken = session.inviteToken ?? null;

    return (
      <main className="page-shell home-page-shell room-page-shell">
        <section className="panel hero-panel lobby-panel waiting-lobby-panel">
          <div className="hero-copy">
            <p className="eyebrow">MSN-style competitive minesweeper</p>
            <h1>Minesweeper Flags</h1>
            <p>
              Room <strong>{roomCode}</strong> is ready. Share the private invite link and the
              match will begin as soon as player two joins.
            </p>
          </div>

          <div className="lobby-stage">
            <LobbyPreviewPanel
              title="Classic duel board"
              badge="2 players"
              featurePills={[
                "Shared 16x16 field",
                "First to 26 mines",
                `One comeback bomb at down ${MIN_BOMB_DEFICIT}+`
              ]}
            />

            <section className="lobby-control-panel">
              <div className="lobby-identity-card">
                <div className="lobby-card-heading">
                  <h2>Room Ready</h2>
                  <span className={`lobby-connection-pill is-${connectionStatus}`}>
                    {connectionStatus}
                  </span>
                </div>

                <div className="field lobby-field">
                  <span>Room reference</span>
                  <div className="invite-code-readonly">{roomCode}</div>
                </div>
              </div>

              <div className="lobby-action-cards">
                <div className="lobby-action-card is-create">
                  <div className="lobby-card-heading">
                    <h2>Share This Room</h2>
                    <span>Copy the private invite link. It already includes the token.</span>
                  </div>

                  <button
                    className="lobby-action-button lobby-create-button"
                    disabled={!inviteLink}
                    onClick={() =>
                      inviteLink
                        ? copyInviteValue(inviteLink, "Invite link copied.")
                        : undefined
                    }
                  >
                    {inviteLink ? "Copy Invite Link" : "Invite Link Unavailable"}
                  </button>
                </div>

                <div className="lobby-action-card is-join">
                  <div className="lobby-card-heading">
                    <h2>Copy Invite Token</h2>
                    <span>{opponent ? "Guest connected." : "Manual fallback."}</span>
                  </div>

                  <div className="field lobby-field">
                    <span>Invite token</span>
                    <div className="invite-code-readonly invite-token-readonly">
                      {inviteToken ?? "Unavailable"}
                    </div>
                  </div>

                  <button
                    className={[
                      "lobby-action-button",
                      "lobby-join-button",
                      inviteToken ? "is-ready" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={!inviteToken}
                    onClick={() =>
                      inviteToken
                        ? copyInviteValue(inviteToken, "Invite token copied.")
                        : undefined
                    }
                  >
                    {inviteToken ? "Copy Invite Token" : "Invite Token Unavailable"}
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="status-strip lobby-status-strip">
            <span className="lobby-status-note">
              {inviteNotice ?? (inviteLink ? "Waiting for player two." : "Invite link unavailable on this device.")}
            </span>
            <span className="lobby-status-note">
              Host: {host?.displayName ?? session.displayName}.{" "}
              {opponent ? `Guest joined as ${opponent.displayName}.` : "Guest slot is open."}
            </span>
            <Link className="lobby-status-link" to="/lobby">
              Back To Lobby
            </Link>
            {error ? <span className="error-text">{error}</span> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell room-page-shell">
      {error ? (
        <section className="panel error-banner">
          <p>{error}</p>
        </section>
      ) : null}

      <MatchView
        roomCode={roomCode}
        currentPlayerId={session.playerId}
        match={match}
        bombArmed={bombArmed}
        connectionStatus={connectionStatus}
        chatMessages={chatMessages}
        chatError={chatError}
        chatDraft={chatDraft}
        chatPending={chatPending}
        onToggleBomb={toggleBombMode}
        onCellSelect={submitCellAction}
        onChatDraftChange={setChatDraft}
        onSendChatMessage={sendChatMessage}
        onResign={resignMatch}
        onRequestRematch={requestRematch}
        onCancelRematch={cancelRematch}
      />
    </main>
  );
};
