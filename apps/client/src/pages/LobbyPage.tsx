import { useEffect, useState } from "react";
import { Navigate, useLocation, useOutletContext } from "react-router-dom";
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
    roomCancelAttempted
  } = useGameClient();

  // The form mounts eagerly inside the hidden panel so the lobby keeps its height, but no
  // transport or health request may start until the player chooses "With a friend".
  const friendActive = useFriendPanelActive();
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (!friendActive || roomCancelAttempted) return;
    openLobby();
    setIsReady(true);
  }, [friendActive, openLobby, roomCancelAttempted]);

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
