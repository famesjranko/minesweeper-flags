import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { Link } from "react-router-dom";
import type { P2PHostSetupState } from "../../p2p/setup/p2p-setup.types.js";
import { LobbyPreviewPanel } from "./LobbyPreviewPanel.js";

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

const getHostSetupSummary = (
  stage: string | null | undefined,
  sessionState: string | null | undefined
): string => {
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

const getHostSetupDetails = (
  stage: string | null | undefined,
  sessionState: string | null | undefined
): string => {
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

const ShareDirectLinkCard = ({
  directJoinLink,
  onCopy
}: {
  directJoinLink: string | null;
  onCopy: (value: string, successMessage: string) => void;
}) => (
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
        type="button"
        className={["lobby-action-button", "lobby-join-button", directJoinLink ? "is-ready" : ""]
          .filter(Boolean)
          .join(" ")}
        disabled={!directJoinLink}
        onClick={() => (directJoinLink ? onCopy(directJoinLink, "Direct link copied.") : undefined)}
      >
        Copy direct link
      </button>
    </div>

    <p className="waiting-share-copy">
      {directJoinLink
        ? "Your guest only needs this link plus a display name to join."
        : "Creating the shareable direct link now."}
    </p>
  </div>
);

interface HostDirectMatchPanelProps {
  roomCode: string;
  connectionStatus: string;
  hostSetup: P2PHostSetupState | null;
  inviteNotice: string | null;
  error: string | null;
  onCopy: (value: string, successMessage: string) => void;
}

// The host's waiting room in a direct match, shown until the guest connects.
export const HostDirectMatchPanel = ({
  roomCode,
  connectionStatus,
  hostSetup,
  inviteNotice,
  error,
  onCopy
}: HostDirectMatchPanelProps) => {
  const hostStageLabel = formatSetupStage(hostSetup?.stage);
  const hostSetupSummary = getHostSetupSummary(hostSetup?.stage, hostSetup?.sessionState);
  const hostSetupDetails = getHostSetupDetails(hostSetup?.stage, hostSetup?.sessionState);

  return (
    <main className="page-shell home-page-shell room-page-shell">
      <section className="panel hero-panel lobby-panel waiting-lobby-panel">
        <div className="hero-copy">
          <p className="eyebrow">Direct browser match</p>
          <h1>Host Direct Match</h1>
          <p>
            Share one direct link with your guest. The app finishes setup automatically as soon as
            they join.
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
                Keep this tab open. Live direct matches now recover after refresh, but this host tab
                still owns the match authority.
              </p>
            </div>

            <div className="lobby-action-cards">
              <ShareDirectLinkCard directJoinLink={hostSetup?.joinUrl ?? null} onCopy={onCopy} />

              <div className="lobby-action-card is-join waiting-room-card">
                <div className="lobby-card-heading">
                  <h2>{getHostSetupHeadline(hostSetup?.stage)}</h2>
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
          <span className="lobby-status-note">{inviteNotice ?? hostSetupSummary}</span>
          <span className="lobby-status-note">{hostSetupDetails}</span>
          <Link className="lobby-status-link" to="/lobby">
            Back to lobby
          </Link>
          {hostSetup?.error ? <span className="error-text">{hostSetup.error}</span> : null}
          {error ? <span className="error-text">{error}</span> : null}
        </div>
      </section>
    </main>
  );
};
