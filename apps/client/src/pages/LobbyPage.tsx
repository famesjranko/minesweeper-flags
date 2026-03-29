import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { RoomLobby } from "../features/room/RoomLobby.js";
import { useGameClient } from "../features/connection/useGameClient.js";

export const LobbyPage = () => {
  const [isReady, setIsReady] = useState(false);
  const { connectionStatus, error, session, createRoom, joinRoom, openLobby, slotAvailability, refreshSlotCount } = useGameClient();

  useEffect(() => {
    openLobby();
    setIsReady(true);
  }, []);

  if (!isReady) {
    return null;
  }

  if (session?.roomCode) {
    return <Navigate to={`/room/${session.roomCode}`} replace />;
  }

  return (
    <main className="page-shell home-page-shell">
      <RoomLobby
        connectionStatus={connectionStatus}
        error={error}
        slotAvailability={slotAvailability}
        onRefreshSlots={refreshSlotCount}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
      />
    </main>
  );
};
