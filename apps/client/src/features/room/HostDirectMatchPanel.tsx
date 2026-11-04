import "./room-waiting.css";

import { Link } from "react-router-dom";
import type { P2PHostSetupState } from "../../p2p/setup/p2p-setup.types.js";
import { LobbyLayout } from "../../shared-ui/LobbyLayout.js";
import { InviteLinkActions, type InviteNotice, InviteNoticeLine } from "./RoomWaitingPanel.js";

const getStageStatus = (stage: string | null | undefined): string => {
  switch (stage) {
    case "creating-offer":
    case "creating-session":
      return "Creating your link…";
    case "applying-answer":
    case "connecting":
      return "Your friend joined. Connecting…";
    case "connected":
      return "Your friend joined.";
    default:
      return "Waiting for your friend…";
  }
};

const getSetupProblem = (
  stage: string | null | undefined,
  sessionState: string | null | undefined
): string | null => {
  if (sessionState === "expired") {
    return "This direct link expired before setup finished. Start a new direct match from the lobby.";
  }
  if (stage === "failed") return "Direct match setup failed. Start a new one from the lobby.";
  if (stage === "closed") return "This direct match closed. Start a new one from the lobby.";
  return null;
};

const isGuestConnecting = (stage: string | null | undefined): boolean =>
  stage === "applying-answer" || stage === "connecting" || stage === "connected";

interface HostDirectMatchPanelProps {
  roomCode: string;
  hostSetup: P2PHostSetupState | null;
  inviteNotice: InviteNotice | null;
  error: string | null;
  onCopy: (value: string, successMessage: string) => void;
  onShare?: ((value: string) => void) | undefined;
}

// The host's waiting room in a direct match, shown until the guest connects.
export const HostDirectMatchPanel = ({
  roomCode,
  hostSetup,
  inviteNotice,
  error,
  onCopy,
  onShare
}: HostDirectMatchPanelProps) => {
  const stage = hostSetup?.stage;
  const setupProblem = getSetupProblem(stage, hostSetup?.sessionState);
  // A specific cause says more than the general failure, so only one of them shows.
  const problems = [hostSetup?.error ?? setupProblem, error].filter((problem): problem is string =>
    Boolean(problem)
  );

  return (
    <LobbyLayout
      stage={
        setupProblem ? undefined : (
          <div className="solo-stage-status" role="status">
            <span className="arcade-room-code">Room {roomCode}</span>
            <span>{getStageStatus(stage)}</span>
          </div>
        )
      }
    >
      <section className="solo-entry-card room-waiting-card" aria-labelledby="room-ready-heading">
        {setupProblem ? (
          <div className="room-waiting-intro">
            <h2 id="room-ready-heading">Room unavailable</h2>
          </div>
        ) : (
          <>
            <div className="room-waiting-intro">
              <h2 id="room-ready-heading">Your room is ready.</h2>
              <p>Share the link. Keep this tab open, because your browser hosts the match.</p>
            </div>
            <div className="arcade-people">
              <div className="arcade-seat">
                <strong title={hostSetup?.displayName || "You"}>
                  {hostSetup?.displayName || "You"}
                </strong>
                <span>Host · Ready</span>
              </div>
              <div className={`arcade-seat${isGuestConnecting(stage) ? "" : " is-open"}`}>
                <strong>Your friend</strong>
                <span>{isGuestConnecting(stage) ? "Connecting…" : "Waiting to join"}</span>
              </div>
            </div>
            <InviteLinkActions
              inviteLink={hostSetup?.joinUrl ?? null}
              pendingText="Creating your link…"
              onCopy={onCopy}
              onShare={onShare}
            />
            {inviteNotice ? <InviteNoticeLine notice={inviteNotice} /> : null}
          </>
        )}
        {problems.map((problem) => (
          <p key={problem} className="arcade-flow-error" role="alert">
            {problem}
          </p>
        ))}
        <Link className="arcade-back room-waiting-back" to="/lobby">
          Back to lobby
        </Link>
      </section>
    </LobbyLayout>
  );
};
