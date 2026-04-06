import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { MatchView } from "../features/match/MatchView.js";
import { LobbyPreviewPanel } from "../features/room/LobbyPreviewPanel.js";
import { buildInvitePath } from "../features/room/invite-link.js";
import { DEPLOYMENT_MODE } from "../lib/config/env.js";

const formatSetupStage = (stage: string | null | undefined): string => {
  if (!stage) {
    return "Starting";
  }

  switch (stage) {
    case "creating-offer":
    case "creating-session":
      return "Creating Direct Link";
    case "waiting-for-guest":
      return "Waiting For Guest";
    case "applying-answer":
      return "Connecting To Guest";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "failed":
      return "Setup Failed";
    case "closed":
      return "Closed";
    default:
      return stage.replace(/-/g, " ");
  }
};

const isDisplacedError = (error: string | null): boolean =>
  error !== null && error.includes("active in another tab or window");

const isRecoveryUnavailableError = (error: string | null): boolean =>
  error !== null && error.includes("recovery is no longer available");

const isClaimVictoryError = (error: string | null): boolean =>
  error !== null && (error.includes("now have control") || error.includes("now have an active claim"));

const getHostSetupHeadline = (stage: string | null | undefined): string => {
  switch (stage) {
    case "waiting-for-guest":
      return "Waiting For Guest";
    case "applying-answer":
    case "connecting":
      return "Connecting To Guest";
    case "connected":
      return "Direct Match Ready";
    case "failed":
      return "Direct Match Failed";
    case "closed":
      return "Direct Match Closed";
    default:
      return "Preparing Direct Match";
  }
};

const getHostSetupSummary = (stage: string | null | undefined, sessionState: string | null | undefined): string => {
  if (sessionState === "expired") {
    return "This direct link expired before setup finished. Start a new direct match from the lobby.";
  }

  switch (stage) {
    case "creating-offer":
    case "creating-session":
      return "Creating your direct link now.";
    case "waiting-for-guest":
      return "Waiting for a guest to open the direct link.";
    case "applying-answer":
      return "Guest found. Finishing the browser-to-browser connection.";
    case "connected":
      return "Guest connected. Loading the match.";
    case "failed":
      return "Direct match setup failed. Start a new one from the lobby.";
    case "closed":
      return "This direct match closed. Start a new one from the lobby.";
    default:
      return "Preparing your direct match.";
  }
};

const getHostSetupDetails = (stage: string | null | undefined, sessionState: string | null | undefined): string => {
  if (sessionState === "expired") {
    return "Expired setup links cannot be recovered. Live direct matches use separate reconnect recovery after both players connect.";
  }

  if (sessionState === "answered") {
    return "A guest joined. The app is applying the connection automatically.";
  }

  if (sessionState === "finalized") {
    return "Setup is finalized. Waiting for the direct channel to finish opening.";
  }

  switch (stage) {
    case "connected":
      return "Room, match, chat, and rematch continue through the normal game client flow once the channel opens.";
    case "failed":
    case "closed":
      return "Use the lobby to create a fresh direct link if you still want to play.";
    default:
      return "Keep this tab open while your guest opens the shared link and joins from their browser.";
  }
};

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
    cancelRematch,
    p2pSetup
  } = useGameClient();
  const isP2PDeployment = DEPLOYMENT_MODE === "p2p";
  const hostSetup = p2pSetup?.host ?? null;

  useEffect(() => {
    if (!roomCode) {
      return;
    }

    if ((!session || session.roomCode !== roomCode) && hasStoredSession(roomCode)) {
      reconnect(roomCode);
    }
  }, [hasStoredSession, reconnect, roomCode, session]);

  if (!roomCode) {
    return null;
  }

  const copyInviteValue = async (value: string, successMessage: string) => {
    try {
      await window.navigator.clipboard.writeText(value);
      setInviteNotice(successMessage);
    } catch {
      setInviteNotice("Copy failed. Copy it manually from the screen.");
    }
  };

  if (!session || session.roomCode !== roomCode) {
    const showConflictGuidance = isDisplacedError(error) || isRecoveryUnavailableError(error);
    const showClaimVictory = isClaimVictoryError(error);

    return (
      <main className="page-shell room-page-shell">
        <section className="panel waiting-panel room-unavailable-panel">
          <h1>Room unavailable</h1>
          <p>
            This browser is not currently attached to room <strong>{roomCode}</strong>.
          </p>
          {showConflictGuidance && (
            <div className="conflict-guidance">
              <p className="conflict-message">{error}</p>
              {isDisplacedError(error) && (
                <p className="conflict-action">
                  Another tab has claimed control. Close other tabs for this room, or reconnect to reclaim control.
                </p>
              )}
              {isRecoveryUnavailableError(error) && (
                <p className="conflict-action">
                  Recovery data was cleared. You can start a fresh direct match from the lobby.
                </p>
              )}
            </div>
          )}
          {showClaimVictory && (
            <div className="claim-victory-notice">
              <p>{error}</p>
            </div>
          )}
          {!showConflictGuidance && !showClaimVictory && (
            <p>
              {error ??
                (isP2PDeployment
                  ? "Direct Match is reconnecting. If recovery does not finish, start a new match from the lobby."
                  : "Create or join the room from the home page first.")}
            </p>
          )}
          <div className="waiting-action-row">
            {hasStoredSession(roomCode) && !showClaimVictory && (
              <button
                className="primary-button"
                onClick={() => reconnect(roomCode)}
              >
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
  }

  if (match) {
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
  }

  if (isP2PDeployment) {
    const directJoinLink = hostSetup?.joinUrl ?? null;
    const hostStageLabel = formatSetupStage(hostSetup?.stage);
    const hostSetupHeadline = getHostSetupHeadline(hostSetup?.stage);
    const hostSetupSummary = getHostSetupSummary(hostSetup?.stage, hostSetup?.sessionState);
    const hostSetupDetails = getHostSetupDetails(hostSetup?.stage, hostSetup?.sessionState);

    return (
      <main className="page-shell home-page-shell room-page-shell">
        <section className="panel hero-panel lobby-panel waiting-lobby-panel">
          <div className="hero-copy">
            <p className="eyebrow">Direct browser match</p>
            <h1>Host Direct Match</h1>
            <p>
              Share one direct link with your guest. The app finishes setup automatically as soon as they join.
            </p>
          </div>

          <div className="lobby-stage waiting-lobby-stage">
            <LobbyPreviewPanel
              title="Classic duel board"
              badge="p2p"
              featurePills={[
                "Browser to browser",
                "Automated signaling",
                `One comeback bomb at down ${MIN_BOMB_DEFICIT}+`
              ]}
            />

            <section className="lobby-control-panel waiting-control-panel">
              <div className="lobby-identity-card waiting-summary-card">
                <div className="lobby-card-heading">
                  <h2>Host Setup</h2>
                  <span className={`lobby-connection-pill is-${connectionStatus}`}>
                    {hostStageLabel}
                  </span>
                </div>

                <div className="invite-room-readout invite-private-readout">
                  <span className="invite-room-readout-label">Setup status</span>
                  <strong>{hostStageLabel}</strong>
                </div>

                <div className="field lobby-field">
                  <span>Room reference</span>
                  <div className="invite-code-readonly">{roomCode}</div>
                </div>

                <p className="waiting-summary-copy">
                  Keep this tab open. Live direct matches now recover after refresh, but this host tab still owns the match authority.
                </p>
              </div>

              <div className="lobby-action-cards">
                <div className="lobby-action-card is-create waiting-share-card">
                  <div className="lobby-card-heading">
                    <h2>Share Direct Link</h2>
                    <span>Send one short link to your guest.</span>
                  </div>

                  {directJoinLink ? (
                    <div className="field lobby-field">
                      <span>Direct join link</span>
                      <textarea
                        className="signaling-payload-input"
                        value={directJoinLink}
                        readOnly
                        aria-label="Direct join link"
                      />
                    </div>
                  ) : null}

                  <div className="waiting-action-grid">
                    <button
                      className={[
                        "lobby-action-button",
                        "lobby-join-button",
                        directJoinLink ? "is-ready" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={!directJoinLink}
                      onClick={() =>
                        directJoinLink
                          ? copyInviteValue(directJoinLink, "Direct link copied.")
                          : undefined
                      }
                    >
                      Copy Direct Link
                    </button>
                  </div>

                  <p className="waiting-share-copy">
                    {directJoinLink
                      ? "Your guest only needs this link plus a display name to join."
                      : "Creating the shareable direct link now."}
                  </p>
                </div>

                <div className="lobby-action-card is-join waiting-room-card">
                  <div className="lobby-card-heading">
                    <h2>{hostSetupHeadline}</h2>
                    <span>{hostSetupSummary}</span>
                  </div>

                  <div className="invite-room-readout invite-private-readout">
                    <span className="invite-room-readout-label">Signaling session</span>
                    <strong>{hostSetup?.sessionState ?? "starting"}</strong>
                  </div>

                  <p className="waiting-room-copy">{hostSetupDetails}</p>
                </div>
              </div>
            </section>
          </div>

          <div className="status-strip lobby-status-strip">
            <span className="lobby-status-note">
              {inviteNotice ?? hostSetupSummary}
            </span>
            <span className="lobby-status-note">{hostSetupDetails}</span>
            <Link className="lobby-status-link" to="/lobby">
              Back To Lobby
            </Link>
            {hostSetup?.error ? <span className="error-text">{hostSetup.error}</span> : null}
            {error ? <span className="error-text">{error}</span> : null}
          </div>
        </section>
      </main>
    );
  }

  const host = session.players[0];
  const opponent = session.players[1];
  const inviteToken = session.inviteToken ?? null;
  const inviteLink =
    session.inviteToken && typeof window !== "undefined"
      ? `${window.location.origin}${buildInvitePath(session.inviteToken)}`
      : session.inviteToken
        ? buildInvitePath(session.inviteToken)
        : null;

  return (
    <main className="page-shell home-page-shell room-page-shell">
      <section className="panel hero-panel lobby-panel waiting-lobby-panel">
        <div className="hero-copy">
          <p className="eyebrow">MSN-style competitive minesweeper</p>
          <h1>Minesweeper Flags</h1>
          <p>
            Room <strong>{roomCode}</strong> is ready. Share the private invite link and the match will begin as soon
            as player two joins.
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
                <span className={`lobby-connection-pill is-${connectionStatus}`}>{connectionStatus}</span>
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
                  <div className="invite-code-readonly invite-token-readonly">{inviteToken ?? "Unavailable"}</div>
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
            Host: {host?.displayName ?? session.displayName}. {opponent ? `Guest joined as ${opponent.displayName}.` : "Guest slot is open."}
          </span>
          <Link className="lobby-status-link" to="/lobby">
            Back To Lobby
          </Link>
          {error ? <span className="error-text">{error}</span> : null}
        </div>
      </section>
    </main>
  );
};
