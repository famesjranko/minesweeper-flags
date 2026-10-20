import { inviteTokenSchema } from "@minesweeper-flags/shared";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { ArcadePage } from "../shared-ui/ArcadePage.js";

type InviteErrorState = "full" | "invalid";

const getInviteErrorState = (
  activeInviteToken: string | null,
  error: string | null
): InviteErrorState | null => {
  if (activeInviteToken === null) {
    return "invalid";
  }

  if (error === "That room is already full.") {
    return "full";
  }

  return error === "That invite link is no longer valid." ? "invalid" : null;
};

const getInviteErrorMessage = (errorState: InviteErrorState, hasInviteToken: boolean): string => {
  if (errorState === "full") {
    return "Another player already filled this room. Ask the host for a fresh room if you still want to play.";
  }

  return hasInviteToken
    ? "This private invite link has expired or is no longer valid."
    : "This invite link is malformed or incomplete.";
};

const InviteErrorPanel = ({
  errorState,
  hasInviteToken,
  error
}: {
  errorState: InviteErrorState;
  hasInviteToken: boolean;
  error: string | null;
}) => (
  <ArcadePage>
    <section className="arcade-flow is-error">
      <div className="arcade-flow-intro">
        <p className="arcade-flow-eyebrow">Private invitation</p>
        <h1>{errorState === "full" ? "Match already claimed" : "Invite unavailable"}</h1>
        <p>{getInviteErrorMessage(errorState, hasInviteToken)}</p>
      </div>
      <div className="arcade-flow-card">
        <Link className="arcade-primary" to="/lobby">
          Back To Lobby
        </Link>
        {error && hasInviteToken ? (
          <p className="arcade-flow-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  </ArcadePage>
);

export const InvitePage = () => {
  const { inviteToken = "" } = useParams();
  const parsedInviteToken = inviteTokenSchema.safeParse(inviteToken.trim());
  const activeInviteToken = parsedInviteToken.success ? parsedInviteToken.data : null;
  const { connectionStatus, error, session, joinRoom, clearError } = useGameClient();
  const [displayName, setDisplayName] = useState("Captain Sweeper");

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear a stale error only when the invite token changes.
  useEffect(() => {
    clearError();
  }, [activeInviteToken]);

  if (session?.roomCode) {
    return <Navigate to={`/room/${session.roomCode}`} replace />;
  }

  const trimmedDisplayName = displayName.trim();
  const canJoin = trimmedDisplayName.length > 0 && activeInviteToken !== null;
  const inviteErrorState = getInviteErrorState(activeInviteToken, error);

  if (inviteErrorState) {
    return (
      <InviteErrorPanel
        errorState={inviteErrorState}
        hasInviteToken={Boolean(activeInviteToken)}
        error={error}
      />
    );
  }

  return (
    <ArcadePage connectionStatus={connectionStatus}>
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
            if (canJoin && activeInviteToken) joinRoom(trimmedDisplayName, activeInviteToken);
          }}
        >
          <div className="arcade-flow-status">
            <span>Invite link loaded</span>
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
            Join Game
          </button>
          <p className="arcade-flow-note">Shared 16×16 board · First to 26 mines</p>
          {error ? (
            <p className="arcade-flow-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <Link className="arcade-back" to="/lobby">
          ← Back To Lobby
        </Link>
      </section>
    </ArcadePage>
  );
};
