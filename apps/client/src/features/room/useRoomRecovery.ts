import { useEffect, useRef, useState } from "react";
import type { ClientSession } from "../../app/providers/game-client.state.js";

interface RoomRecoveryOptions {
  roomCode: string;
  session: ClientSession | null;
  hasMatch: boolean;
  error: string | null;
  hasStoredSession: (roomCode: string) => boolean;
  reconnect: (roomCode: string) => void;
}

export const useRoomRecovery = ({
  roomCode,
  session,
  hasMatch,
  error,
  hasStoredSession,
  reconnect
}: RoomRecoveryOptions) => {
  const bootstrappedRoom = useRef<string | null>(null);
  const [recoveringRoom, setRecoveringRoom] = useState<string | null>(null);
  const hasSeat = session?.roomCode === roomCode;
  const shouldBootstrap =
    !!roomCode &&
    !error &&
    !hasSeat &&
    hasStoredSession(roomCode) &&
    bootstrappedRoom.current !== roomCode;

  useEffect(() => {
    if (!roomCode || bootstrappedRoom.current === roomCode) return;
    // Bootstrap once. A displaced tab must leave reclaiming control to the user.
    bootstrappedRoom.current = roomCode;
    if (shouldBootstrap) {
      setRecoveringRoom(roomCode);
      reconnect(roomCode);
    }
  }, [roomCode, shouldBootstrap, reconnect]);

  const retry = () => {
    setRecoveringRoom(roomCode);
    reconnect(roomCode);
  };

  // The seat arrives before the board. Two players mean a match snapshot follows;
  // one player means recovery has finished in the waiting room.
  const isRestoring =
    !error &&
    (shouldBootstrap || recoveringRoom === roomCode) &&
    (!hasSeat || (!hasMatch && session.players.length > 1));

  return { isRestoring, reconnect: retry };
};
