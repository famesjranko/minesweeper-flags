import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useGameClient } from "../../features/connection/useGameClient.js";
import { LobbyPreviewPanel } from "../../features/room/LobbyPreviewPanel.js";
import { DEPLOYMENT_MODE } from "../../lib/config/env.js";
import { getGuestDirectJoinUnavailableMessage } from "../setup/p2p-setup.controller.js";

const getStaleLinkLabel = (sessionState: "expired" | "answered" | "finalized"): string => {
  switch (sessionState) {
    case "expired":
      return "Expired";
    case "answered":
      return "Already used";
    case "finalized":
      return "Finalized";
  }
};

export const P2PJoinPage = () => {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const {
    connectionStatus,
    error,
    session,
    p2pSetup,
    openGuestSetupSession,
    createGuestAnswer,
    clearGuestSetupError
  } = useGameClient();
  const [displayName, setDisplayName] = useState("Captain Sweeper");
  const guestSetup = p2pSetup?.guest ?? null;
  const trimmedDisplayName = displayName.trim();
  const unavailableMessage = getGuestDirectJoinUnavailableMessage(guestSetup?.sessionState);
  const canCreateAnswer =
    trimmedDisplayName.length > 0 &&
    guestSetup?.offerPayload !== null &&
    guestSetup?.sessionState === "open";

  useEffect(() => {
    if (session?.roomCode) {
      return;
    }

    openGuestSetupSession(sessionId);
  }, [openGuestSetupSession, session?.roomCode, sessionId]);

  if (DEPLOYMENT_MODE !== "p2p") {
    return <Navigate to="/lobby" replace />;
  }

  if (session?.roomCode) {
    return <Navigate to={`/room/${session.roomCode}`} replace />;
  }

  const inviteBannerLabel = guestSetup?.stage === "waiting-for-host-finalize"
    ? "Connecting to host"
    : unavailableMessage || guestSetup?.error
      ? "Direct link unavailable"
      : guestSetup?.offerPayload
        ? "Direct link loaded"
        : "Loading direct link";
  const directLinkReadout = unavailableMessage && guestSetup?.sessionState && guestSetup.sessionState !== "open"
    ? getStaleLinkLabel(guestSetup.sessionState)
    : guestSetup?.offerPayload
      ? "Loaded from session"
      : "Loading session";
  const setupSummary = unavailableMessage
    ? unavailableMessage
    : "This flow creates your WebRTC answer behind the scenes and waits for the host to finish setup.";
  const joinSummary = unavailableMessage
    ? "This invite can no longer create a guest answer. Ask the host to start a new direct match."
    : "Keep this tab open while the app submits your join request and opens the direct connection.";
  const statusSummary = unavailableMessage
    ? "This direct match link is no longer joinable."
    : guestSetup?.offerPayload
      ? `Direct match ready for ${guestSetup.displayName || "this guest"}.`
      : "Loading the host's direct link.";
  const statusDetail = unavailableMessage
    ? "Only open direct-match sessions can create a guest answer."
    : guestSetup?.stage === "waiting-for-host-finalize" || guestSetup?.stage === "connecting"
      ? "Waiting for the host to finish setup and open the direct channel."
      : "Pick a display name to unlock Join Direct Match.";

  return (
    <main className="page-shell home-page-shell">
      <section className="panel hero-panel lobby-panel invite-panel">
        <div className="hero-copy invite-hero-copy">
          <p className="eyebrow">Direct match invitation</p>
          <h1>Join Direct Match</h1>
          <div className="invite-room-banner">
            <span className="invite-room-banner-label">{inviteBannerLabel}</span>
            <strong>Guest setup</strong>
          </div>
          <p>
            Open the host's link, enter your display name, and let the app finish the direct setup automatically.
          </p>
        </div>

        <div className="lobby-stage invite-stage">
          <LobbyPreviewPanel
            title="Incoming direct match"
            badge="p2p"
            featurePills={["Browser to browser", "Automated signaling", "Shared 16x16 field"]}
          />

          <section className="lobby-control-panel invite-control-panel">
            <div className="lobby-identity-card invite-summary-card">
              <div className="lobby-card-heading">
                <h2>Guest Join Flow</h2>
                <span className={`lobby-connection-pill is-${connectionStatus}`}>{connectionStatus}</span>
              </div>

              <div className="invite-room-readout invite-private-readout">
                <span className="invite-room-readout-label">Direct link</span>
                <strong>{directLinkReadout}</strong>
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

              <p className="invite-info-copy">
                {setupSummary}
              </p>
            </div>

            <section className="lobby-action-card is-join invite-join-card">
              <div className="lobby-card-heading">
                <h2>Join Direct Match</h2>
                <span>{unavailableMessage ? "This invite needs a fresh host link." : "Confirm your display name and connect to the host."}</span>
              </div>

              <p className="invite-info-copy">
                {joinSummary}
              </p>

              <button
                className={[
                  "lobby-action-button",
                  "lobby-join-button",
                  canCreateAnswer ? "is-ready" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={
                  !canCreateAnswer ||
                  guestSetup?.stage === "creating-answer" ||
                  guestSetup?.stage === "submitting-answer" ||
                  guestSetup?.stage === "waiting-for-host-finalize"
                }
                onClick={() => {
                  clearGuestSetupError();
                  createGuestAnswer(trimmedDisplayName);
                }}
              >
                {guestSetup?.stage === "creating-answer"
                  ? "Joining Direct Match..."
                    : guestSetup?.stage === "submitting-answer"
                      ? "Joining Direct Match..."
                      : guestSetup?.stage === "waiting-for-host-finalize"
                        ? "Connecting To Host..."
                        : "Join Direct Match"}
              </button>

              <div className="invite-secondary-actions">
                <Link className="secondary-button link-button" to="/">
                  Back To Home
                </Link>
              </div>
            </section>
          </section>
        </div>

        <div className="status-strip lobby-status-strip invite-status-strip">
          <span className="lobby-status-note">
            {statusSummary}
          </span>
          <span className="lobby-status-note">
            {statusDetail}
          </span>
          {guestSetup?.error ? <span className="error-text">{guestSetup.error}</span> : null}
          {error ? <span className="error-text">{error}</span> : null}
        </div>
      </section>
    </main>
  );
};
