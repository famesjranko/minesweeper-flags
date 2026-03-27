import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { LobbyPreviewPanel } from "../features/room/LobbyPreviewPanel.js";
import { getStoredSession } from "../lib/socket/session-storage.js";
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

    if (!session || session.roomCode !== roomCode) {
      const storedSession = getStoredSession(roomCode);

      if (storedSession) {
        reconnect(roomCode);
      }
    }
  }, [reconnect, roomCode, session]);

  const inviteLink =
    typeof window === "undefined"
      ? `/invite/${roomCode}`
      : `${window.location.origin}/invite/${roomCode}`;

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
            <Link className="primary-button link-button" to={`/invite/${roomCode}`}>
              Open Invite Page
            </Link>
            <Link className="secondary-button link-button" to="/lobby">
              Go To Lobby
            </Link>
          </div>
          <p className="waiting-room-note">
            Share links should use <strong>/invite/{roomCode}</strong>. This page is only for a
            browser that already has a saved room session.
          </p>
        </section>
      </main>
    );
  }

  if (!match) {
    const host = session.players[0];
    const opponent = session.players[1];

    return (
      <main className="page-shell home-page-shell room-page-shell">
        <section className="panel hero-panel lobby-panel waiting-lobby-panel">
          <div className="hero-copy">
            <p className="eyebrow">MSN-style competitive minesweeper</p>
            <h1>Minesweeper Flags</h1>
            <p>
              Room <strong>{roomCode}</strong> is ready. Share the code or invite link and
              the match will begin as soon as player two joins.
            </p>
          </div>

          <div className="lobby-stage">
            <LobbyPreviewPanel
              title="Classic duel board"
              badge="2 players"
              featurePills={[
                "Shared 16x16 field",
                "First to 26 mines",
                "One comeback bomb"
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
                  <span>Invite code</span>
                  <div className="invite-code-readonly">{roomCode}</div>
                </div>
              </div>

              <div className="lobby-action-cards">
                <div className="lobby-action-card is-create">
                  <div className="lobby-card-heading">
                    <h2>Share This Room</h2>
                    <span>Copy the invite link for one-click join.</span>
                  </div>

                  <button
                    className="lobby-action-button lobby-create-button"
                    onClick={() => copyInviteValue(inviteLink, "Invite link copied.")}
                  >
                    Copy Invite Link
                  </button>
                </div>

                <div className="lobby-action-card is-join">
                  <div className="lobby-card-heading">
                    <h2>Share Room Code</h2>
                    <span>{opponent ? "Guest connected." : "Manual join backup."}</span>
                  </div>

                  <div className="field lobby-field">
                    <span>Invite code</span>
                    <div className="invite-code-readonly">{roomCode}</div>
                  </div>

                  <button
                    className="lobby-action-button lobby-join-button is-ready"
                    onClick={() => copyInviteValue(roomCode, "Invite code copied.")}
                  >
                    Copy Code
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="status-strip lobby-status-strip">
            <span className="lobby-status-note">{inviteNotice ?? "Waiting for player two."}</span>
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
