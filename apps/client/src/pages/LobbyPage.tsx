import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useOutletContext } from "react-router-dom";
import { useGameClient } from "../features/connection/useGameClient.js";
import { RoomLobby } from "../features/room/RoomLobby.js";
import { DEPLOYMENT_MODE } from "../lib/config/env.js";
import { HomePage, useFriendPanelActive } from "./HomePage.js";

const FriendLobby = () => {
  const {
    openLobby,
    connectionStatus,
    error,
    session,
    createRoom,
    joinRoom,
    slotAvailability,
    refreshSlotCount,
    roomCancelPending,
    roomCancelAttempted,
    match
  } = useGameClient();
  // Browser Back from a live match lands here. Leaving the match must be a choice, so the
  // lobby neither disconnects it nor redirects back (a redirect would trap Back).
  const liveMatchRoom = session && match?.phase === "live" ? session.roomCode : null;

  // The form mounts eagerly inside the hidden panel so the lobby keeps its height, but no
  // transport or health request may start until the player chooses "With a friend".
  const friendActive = useFriendPanelActive();
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (!friendActive || roomCancelAttempted || liveMatchRoom) return;
    openLobby();
    setIsReady(true);
  }, [friendActive, openLobby, roomCancelAttempted, liveMatchRoom]);

  if (liveMatchRoom) {
    return (
      <section className="arcade-lobby lobby-form lobby-match-in-progress" role="status">
        <p>Your match in room {liveMatchRoom} is still in progress.</p>
        <Link className="lobby-action-button lobby-create-button" to={`/room/${liveMatchRoom}`}>
          Return to match
        </Link>
      </section>
    );
  }

  if (isReady && session?.roomCode && !roomCancelPending) {
    // Push, so browser Back returns here and the router cancels the abandoned waiting room.
    return <Navigate to={`/room/${session.roomCode}`} />;
  }

  return (
    <RoomLobby
      connectionStatus={connectionStatus}
      deploymentMode={DEPLOYMENT_MODE}
      error={error}
      slotAvailability={slotAvailability}
      onRefreshSlots={refreshSlotCount}
      onCreateRoom={createRoom}
      onJoinRoom={joinRoom}
    />
  );
};

export const LobbyPage = () => {
  const { pathname } = useLocation();
  const requestFriend = useOutletContext<(() => void) | undefined>();
  const { connectionStatus } = useGameClient();
  return (
    <HomePage
      initialMode={pathname === "/lobby" ? "friend" : "solo"}
      connectionStatus={connectionStatus}
      onFriendSelected={() => requestFriend?.()}
      friendContent={<FriendLobby />}
    />
  );
};
