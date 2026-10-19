import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { Link } from "react-router-dom";
import type { GameClientSnapshot } from "../../app/providers/game-client.store.js";
import { buildInvitePath } from "./invite-link.js";
import { LobbyPreviewPanel } from "./LobbyPreviewPanel.js";

type RoomSession = NonNullable<GameClientSnapshot["session"]>;

const getInviteLink = (inviteToken: string | undefined): string | null => {
  if (!inviteToken) {
    return null;
  }

  return typeof window !== "undefined"
    ? `${window.location.origin}${buildInvitePath(inviteToken)}`
    : buildInvitePath(inviteToken);
};

interface ShareCardsProps {
  inviteLink: string | null;
  inviteToken: string | null;
  hasOpponent: boolean;
  onCopy: (value: string, successMessage: string) => void;
}

const ShareRoomCards = ({ inviteLink, inviteToken, hasOpponent, onCopy }: ShareCardsProps) => (
  <div className="lobby-action-cards">
    <div className="lobby-action-card is-create">
      <div className="lobby-card-heading">
        <h2>Share This Room</h2>
        <span>Copy the private invite link. It already includes the token.</span>
      </div>

      <button
        type="button"
        className="lobby-action-button lobby-create-button"
        disabled={!inviteLink}
        onClick={() => (inviteLink ? onCopy(inviteLink, "Invite link copied.") : undefined)}
      >
        {inviteLink ? "Copy Invite Link" : "Invite Link Unavailable"}
      </button>
    </div>

    <div className="lobby-action-card is-join">
      <div className="lobby-card-heading">
        <h2>Copy Invite Token</h2>
        <span>{hasOpponent ? "Guest connected." : "Manual fallback."}</span>
      </div>

      <div className="field lobby-field">
        <span>Invite token</span>
        <div className="invite-code-readonly invite-token-readonly">
          {inviteToken ?? "Unavailable"}
        </div>
      </div>

      <button
        type="button"
        className={["lobby-action-button", "lobby-join-button", inviteToken ? "is-ready" : ""]
          .filter(Boolean)
          .join(" ")}
        disabled={!inviteToken}
        onClick={() => (inviteToken ? onCopy(inviteToken, "Invite token copied.") : undefined)}
      >
        {inviteToken ? "Copy Invite Token" : "Invite Token Unavailable"}
      </button>
    </div>
  </div>
);

interface RoomWaitingPanelProps {
  roomCode: string;
  connectionStatus: string;
  session: RoomSession;
  inviteNotice: string | null;
  error: string | null;
  onCopy: (value: string, successMessage: string) => void;
}

// The server-hosted waiting room, shown to the host until player two joins.
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
  const inviteLink = getInviteLink(session.inviteToken);

  return (
    <main className="page-shell home-page-shell room-page-shell">
      <section className="panel hero-panel lobby-panel waiting-lobby-panel">
        <div className="hero-copy">
          <p className="eyebrow">MSN-style competitive minesweeper</p>
          <h1>Minesweeper Flags</h1>
          <p>
            Room <strong>{roomCode}</strong> is ready. Share the private invite link and the match
            will begin as soon as player two joins.
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

            <ShareRoomCards
              inviteLink={inviteLink}
              inviteToken={inviteToken}
              hasOpponent={Boolean(opponent)}
              onCopy={onCopy}
            />
          </section>
        </div>

        <div className="status-strip lobby-status-strip">
          <span className="lobby-status-note">
            {inviteNotice ??
              (inviteLink ? "Waiting for player two." : "Invite link unavailable on this device.")}
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
};
