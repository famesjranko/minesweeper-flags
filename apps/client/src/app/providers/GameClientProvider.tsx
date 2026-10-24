import type { BoardSize } from "@minesweeper-flags/game-engine";
import type { ChatMessageDto, MatchStateDto } from "@minesweeper-flags/shared";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { DEPLOYMENT_MODE, SERVER_HEALTH_URL } from "../../lib/config/env.js";
import type { P2PSetupSnapshot } from "../../p2p/setup/p2p-setup.types.js";
import { createGameClientRuntime, type GameClientRuntime } from "./game-client.runtime.js";
import type { ClientSession } from "./game-client.state.js";
import type { ConnectionStatus } from "./game-client.store.js";

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
  roomCancelPending: boolean;
  roomCancelAttempted: boolean;
  slotAvailability: SlotAvailability | null;
  refreshSlotCount: () => void;
  hasStoredSession: (roomCode: string) => boolean;
  openLobby: () => void;
  createRoom: (displayName: string, boardSize?: BoardSize) => void;
  joinRoom: (displayName: string, inviteToken: string) => void;
  reconnect: (roomCode: string) => void;
  submitCellAction: (row: number, column: number) => void;
  setChatDraft: (value: string) => void;
  sendChatMessage: () => void;
  toggleBombMode: () => void;
  resignMatch: () => void;
  requestRematch: () => void;
  cancelRematch: () => void;
  cancelRoom: () => void;
  clearError: () => void;
  p2pSetup: P2PSetupSnapshot | null;
  openGuestSetupSession: (sessionId: string) => void;
  openGuestSetupFromFragment: (fragment: string) => void;
  createGuestAnswer: (displayName: string) => void;
  setHostGuestAnswerText: (value: string) => void;
  applyHostGuestAnswer: () => boolean;
  clearHostSetupError: () => void;
  clearGuestSetupError: () => void;
}

const GameClientContext = createContext<GameClientContextValue | null>(null);
const subscribeToEmptySnapshot = (_listener: () => void) => () => {};
const getEmptyP2PSnapshot = (): null => null;

const useSlotAvailability = () => {
  const slotRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotRefreshAbortRef = useRef<AbortController | null>(null);
  const [slotAvailability, setSlotAvailability] = useState<SlotAvailability | null>(null);

  const cancelSlotRefresh = useCallback(() => {
    if (slotRefreshTimerRef.current !== null) {
      clearTimeout(slotRefreshTimerRef.current);
      slotRefreshTimerRef.current = null;
    }
    slotRefreshAbortRef.current?.abort();
    slotRefreshAbortRef.current = null;
  }, []);

  const refreshSlotCount = useCallback(() => {
    slotRefreshAbortRef.current?.abort();
    const abortController = new AbortController();
    slotRefreshAbortRef.current = abortController;

    fetch(SERVER_HEALTH_URL, { signal: abortController.signal })
      .then((res) => res.json())
      .then((data: { activeRooms?: number; maxRooms?: number }) => {
        if (
          !abortController.signal.aborted &&
          typeof data.activeRooms === "number" &&
          typeof data.maxRooms === "number"
        ) {
          setSlotAvailability({ activeRooms: data.activeRooms, maxRooms: data.maxRooms });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (slotRefreshAbortRef.current === abortController) {
          slotRefreshAbortRef.current = null;
        }
      });
  }, []);

  const scheduleSlotRefresh = useCallback(() => {
    if (slotRefreshTimerRef.current !== null) {
      clearTimeout(slotRefreshTimerRef.current);
    }
    slotRefreshTimerRef.current = setTimeout(refreshSlotCount, 500);
  }, [refreshSlotCount]);

  return { cancelSlotRefresh, refreshSlotCount, scheduleSlotRefresh, slotAvailability };
};

export const GameClientProvider = ({
  children,
  enabled = true
}: PropsWithChildren<{ enabled?: boolean }>) => {
  const runtimeRef = useRef<GameClientRuntime | null>(null);
  const { cancelSlotRefresh, refreshSlotCount, scheduleSlotRefresh, slotAvailability } =
    useSlotAvailability();

  if (!runtimeRef.current) {
    runtimeRef.current = createGameClientRuntime();
  }

  const runtime = runtimeRef.current;
  const snapshot = useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getSnapshot,
    runtime.store.getSnapshot
  );
  const p2pSetupSnapshot = useSyncExternalStore(
    runtime.p2p?.subscribe ?? subscribeToEmptySnapshot,
    runtime.p2p?.getSnapshot ?? getEmptyP2PSnapshot,
    runtime.p2p?.getSnapshot ?? getEmptyP2PSnapshot
  );

  // LobbyPage calls openLobby from an effect keyed on its identity, and
  // openLobby updates the store. A new function on every render would loop.
  const openLobby = useCallback(() => {
    runtime.controller.openLobby();
    if (DEPLOYMENT_MODE === "server") {
      scheduleSlotRefresh();
    }
  }, [runtime, scheduleSlotRefresh]);

  useEffect(() => {
    // The shared lobby stays mounted while solo is selected; networking starts on friend intent.
    if (!enabled) return;

    runtime.controller.start();
    if (DEPLOYMENT_MODE === "server") {
      refreshSlotCount();
    }

    return () => {
      cancelSlotRefresh();
      runtime.controller.dispose();
    };
  }, [cancelSlotRefresh, runtime, refreshSlotCount, enabled]);

  const previousCancellation = useRef(false);
  useEffect(() => {
    if (
      previousCancellation.current &&
      !snapshot.roomCancelPending &&
      !snapshot.session &&
      DEPLOYMENT_MODE === "server"
    ) {
      refreshSlotCount();
    }
    previousCancellation.current = snapshot.roomCancelPending;
  }, [refreshSlotCount, snapshot.roomCancelPending, snapshot.session]);

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
        roomCancelPending: snapshot.roomCancelPending,
        roomCancelAttempted: snapshot.roomCancelAttempted,
        slotAvailability,
        refreshSlotCount,
        hasStoredSession: runtime.controller.hasStoredSession,
        openLobby,
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
        cancelRoom: runtime.controller.cancelRoom,
        clearError: runtime.controller.clearError,
        p2pSetup: p2pSetupSnapshot,
        openGuestSetupSession: runtime.p2p?.controller.openGuestSetupSession ?? (() => {}),
        openGuestSetupFromFragment:
          runtime.p2p?.controller.openGuestSetupFromFragment ?? (() => {}),
        createGuestAnswer: runtime.p2p?.controller.createGuestAnswer ?? (() => {}),
        setHostGuestAnswerText: runtime.p2p?.controller.setHostGuestAnswerText ?? (() => {}),
        applyHostGuestAnswer: runtime.p2p?.controller.applyHostGuestAnswer ?? (() => false),
        clearHostSetupError: runtime.p2p?.controller.clearHostSetupError ?? (() => {}),
        clearGuestSetupError: runtime.p2p?.controller.clearGuestSetupError ?? (() => {})
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
