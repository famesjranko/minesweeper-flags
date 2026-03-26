import { Navigate, useSearchParams } from "react-router-dom";
import { RoomLobby } from "../features/room/RoomLobby.js";
import { useGameClient } from "../features/connection/useGameClient.js";

export const HomePage = () => {
  const [searchParams] = useSearchParams();
  const { connectionStatus, error, session, createRoom, joinRoom } = useGameClient();
  const joinCode = searchParams.get("join")?.toUpperCase() ?? "";

  if (session?.roomCode) {
    return <Navigate to={`/room/${session.roomCode}`} replace />;
  }

  return (
    <main className="page-shell home-page-shell">
      <RoomLobby
        connectionStatus={connectionStatus}
        error={error}
        initialRoomCode={joinCode}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
      />
    </main>
  );
};
