import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useGameClient } from "../../features/connection/useGameClient.js";
import { DEFAULT_GUEST_NAME } from "../../features/room/default-names.js";
import { DEPLOYMENT_MODE } from "../../lib/config/env.js";
import { ArcadePage } from "../../shared-ui/ArcadePage.js";
import { getGuestDirectJoinUnavailableMessage } from "../setup/p2p-setup.controller.js";
import type { P2PGuestSetupState } from "../setup/p2p-setup.types.js";

type GuestSetup = P2PGuestSetupState | null;

const getLinkStatus = (guestSetup: GuestSetup): string => {
  if (guestSetup?.stage === "waiting-for-host-finalize") return "Connecting to host…";
  if (guestSetup?.error) return "Direct link unavailable";
  return guestSetup?.offerPayload ? "Direct link loaded" : "Loading direct link";
};

const getJoinLabel = (stage: P2PGuestSetupState["stage"] | undefined): string => {
  if (stage === "creating-answer" || stage === "submitting-answer") return "Joining…";
  return stage === "waiting-for-host-finalize" ? "Connecting to host…" : "Join game";
};

const isJoining = (stage: P2PGuestSetupState["stage"] | undefined): boolean =>
  stage === "creating-answer" ||
  stage === "submitting-answer" ||
  stage === "waiting-for-host-finalize";

const LinkUnavailablePanel = ({ message }: { message: string }) => (
  <ArcadePage>
    <section className="arcade-flow is-error">
      <div className="arcade-flow-intro">
        <p className="arcade-flow-eyebrow">Private invitation</p>
        <h1>Invite unavailable</h1>
        <p>{message}</p>
      </div>
      <div className="arcade-flow-card">
        <Link className="arcade-primary" to="/lobby">
          Back to lobby
        </Link>
      </div>
    </section>
  </ArcadePage>
);

export const P2PJoinPage = () => {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const {
    error,
    session,
    p2pSetup,
    openGuestSetupSession,
    createGuestAnswer,
    clearGuestSetupError
  } = useGameClient();
  const [displayName, setDisplayName] = useState(DEFAULT_GUEST_NAME);
  const guestSetup = p2pSetup?.guest ?? null;
  const trimmedDisplayName = displayName.trim();
  const unavailableMessage = getGuestDirectJoinUnavailableMessage(guestSetup?.sessionState);
  const canJoin =
    trimmedDisplayName.length > 0 &&
    guestSetup?.offerPayload !== null &&
    guestSetup?.sessionState === "open" &&
    !isJoining(guestSetup?.stage);

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

  // A link that never loaded has nothing to join, as much as a used one.
  const linkProblem =
    unavailableMessage ?? (guestSetup?.offerPayload ? null : (guestSetup?.error ?? null));
  if (linkProblem) {
    return <LinkUnavailablePanel message={linkProblem} />;
  }

  return (
    <ArcadePage>
      <section className="arcade-flow">
        <div className="arcade-flow-intro">
          <p className="arcade-flow-eyebrow">Private invitation</p>
          <h1>A friend invited you.</h1>
          <p>Choose a display name to join their game.</p>
        </div>
        <form
          className="arcade-flow-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canJoin) return;
            clearGuestSetupError();
            createGuestAnswer(trimmedDisplayName);
          }}
        >
          <div className="arcade-flow-status">
            <span>{getLinkStatus(guestSetup)}</span>
            <span>Guest seat</span>
          </div>
          <label className="arcade-field">
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={20}
              placeholder="Enter your display name"
            />
          </label>
          <button type="submit" className="arcade-primary" disabled={!canJoin}>
            {getJoinLabel(guestSetup?.stage)}
          </button>
          <p className="arcade-flow-note">Shared 16×16 board · First to 26 wins</p>
          {[guestSetup?.error, error].filter(Boolean).map((problem) => (
            <p key={problem} className="arcade-flow-error" role="alert">
              {problem}
            </p>
          ))}
        </form>
        <Link className="arcade-back" to="/lobby">
          ← Back to lobby
        </Link>
      </section>
    </ArcadePage>
  );
};
