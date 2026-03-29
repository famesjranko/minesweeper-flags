import type { ChatMessageDto, MatchStateDto } from "@minesweeper-flags/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren
} from "react";
import type { ClientSession } from "./game-client.state.js";
import {
  createGameClientRuntime,
  type GameClientRuntime
} from "./game-client.runtime.js";
import type { ConnectionStatus } from "./game-client.store.js";
import { SERVER_HEALTH_URL } from "../../lib/config/env.js";

export interface SlotAvailability {
  activeRooms: number;
  maxRooms: number;
}

interface GameClientContextValue {
  connectionStatus: ConnectionStatus;
  error: string | null;
  session: ClientSession | null;
  match: MatchStateDto | null;
  bombArmed: boolean;
  chatMessages: ChatMessageDto[];
  chatError: string | null;
  chatDraft: string;
  chatPending: boolean;
  slotAvailability: SlotAvailability | null;
  refreshSlotCount: () => void;
  hasStoredSession: (roomCode: string) => boolean;
  openLobby: () => void;
  createRoom: (displayName: string) => void;
  joinRoom: (displayName: string, inviteToken: string) => void;
  reconnect: (roomCode: string) => void;
  submitCellAction: (row: number, column: number) => void;
  setChatDraft: (value: string) => void;
  sendChatMessage: () => void;
  toggleBombMode: () => void;
  resignMatch: () => void;
  requestRematch: () => void;
  cancelRematch: () => void;
  clearError: () => void;
}

const GameClientContext = createContext<GameClientContextValue | null>(null);

export const GameClientProvider = ({ children }: PropsWithChildren) => {
  const runtimeRef = useRef<GameClientRuntime | null>(null);
  const [slotAvailability, setSlotAvailability] = useState<SlotAvailability | null>(null);

  if (!runtimeRef.current) {
    runtimeRef.current = createGameClientRuntime();
  }

  const runtime = runtimeRef.current;
  const snapshot = useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getSnapshot,
    runtime.store.getSnapshot
  );

  const refreshSlotCount = useCallback(() => {
    fetch(SERVER_HEALTH_URL)
      .then((res) => res.json())
      .then((data: { activeRooms?: number; maxRooms?: number }) => {
        if (typeof data.activeRooms === "number" && typeof data.maxRooms === "number") {
          setSlotAvailability({ activeRooms: data.activeRooms, maxRooms: data.maxRooms });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    runtime.controller.start();
    refreshSlotCount();

    return () => {
      runtime.controller.dispose();
    };
  }, [runtime, refreshSlotCount]);

  return (
    <GameClientContext.Provider
      value={{
        connectionStatus: snapshot.connectionStatus,
        error: snapshot.error,
        session: snapshot.session,
        match: snapshot.match,
        bombArmed: snapshot.bombArmed,
        chatMessages: snapshot.chatMessages,
        chatError: snapshot.chatError,
        chatDraft: snapshot.chatDraft,
        chatPending: snapshot.chatPendingText !== null,
        slotAvailability,
        refreshSlotCount,
        hasStoredSession: runtime.controller.hasStoredSession,
        openLobby: () => {
          runtime.controller.openLobby();
          setTimeout(refreshSlotCount, 500);
        },
        createRoom: runtime.controller.createRoom,
        joinRoom: runtime.controller.joinRoom,
        reconnect: runtime.controller.reconnect,
        submitCellAction: runtime.controller.submitCellAction,
        setChatDraft: runtime.controller.setChatDraft,
        sendChatMessage: runtime.controller.sendChatMessage,
        toggleBombMode: runtime.controller.toggleBombMode,
        resignMatch: runtime.controller.resignMatch,
        requestRematch: runtime.controller.requestRematch,
        cancelRematch: runtime.controller.cancelRematch,
        clearError: runtime.controller.clearError
      }}
    >
      {children}
    </GameClientContext.Provider>
  );
};

export const useGameClientContext = () => {
  const context = useContext(GameClientContext);

  if (!context) {
    throw new Error("Game client context must be used inside its provider.");
  }

  return context;
};
