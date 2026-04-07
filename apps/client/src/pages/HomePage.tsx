import { Navigate } from "react-router-dom";
import { RoomLobby } from "../features/room/RoomLobby.js";
import { useGameClient } from "../features/connection/useGameClient.js";
import { DEPLOYMENT_MODE } from "../lib/config/env.js";

export const HomePage = () => {
  const { connectionStatus, error, session, createRoom, joinRoom, slotAvailability, refreshSlotCount } = useGameClient();

  if (session?.roomCode) {
    return <Navigate to={`/room/${session.roomCode}`} replace />;
  }

  return (
    <main className="page-shell home-page-shell">
      <RoomLobby
        connectionStatus={connectionStatus}
        deploymentMode={DEPLOYMENT_MODE}
        error={error}
        slotAvailability={slotAvailability}
        onRefreshSlots={refreshSlotCount}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
      />
    </main>
  );
};
