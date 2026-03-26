import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type ChatMessageDto,
  type ClientEvent,
  type MatchStateDto
} from "@minesweeper-flags/shared";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { SERVER_URL } from "../../lib/config/env.js";
import {
  getStoredSession,
  removeStoredSession,
  storeSession,
  type StoredSession
} from "../../lib/socket/session-storage.js";
import { decodeServerEvent } from "./game-client.protocol.js";
import {
  buildReconnectEvent,
  buildSessionFromRoomEvent,
  appendChatMessage,
  createLobbyRuntimeState,
  replaceChatHistory,
  shouldApplyServerEvent,
  shouldQueueWhileOffline,
  type ClientSession
} from "./game-client.state.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

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
  openLobby: () => void;
  createRoom: (displayName: string) => void;
  joinRoom: (displayName: string, roomCode: string) => void;
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

const updateRematchState = (match: MatchStateDto, players: Array<{ playerId: string; rematchRequested: boolean }>) => ({
  ...match,
  players: match.players.map((player) => ({
    ...player,
    rematchRequested:
      players.find((entry) => entry.playerId === player.playerId)?.rematchRequested ?? player.rematchRequested
  })) as MatchStateDto["players"]
});

export const GameClientProvider = ({ children }: PropsWithChildren) => {
  const initialState = createLobbyRuntimeState();

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(initialState.error);
  const [session, setSession] = useState<ClientSession | null>(initialState.session);
  const [match, setMatch] = useState<MatchStateDto | null>(initialState.match);
  const [bombArmed, setBombArmed] = useState(initialState.bombArmed);
  const [chatMessages, setChatMessages] = useState<ChatMessageDto[]>(initialState.chatMessages);
  const [chatError, setChatError] = useState<string | null>(initialState.chatError);
  const [chatDraft, setChatDraftState] = useState(initialState.chatDraft);
  const [chatPendingText, setChatPendingTextState] = useState<string | null>(
    initialState.chatPendingText
  );

  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<ClientSession | null>(initialState.session);
  const pendingEventsRef = useRef<ClientEvent[]>(initialState.pendingEvents);
  const reconnectAttemptRef = useRef<StoredSession | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const chatPendingTextRef = useRef<string | null>(initialState.chatPendingText);

  const setPendingChatText = (nextPendingText: string | null) => {
    chatPendingTextRef.current = nextPendingText;
    setChatPendingTextState(nextPendingText);
  };

  const setChatDraft = (value: string) => {
    setChatDraftState(value);
    setChatError(null);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const setClientSession = (nextSession: ClientSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);

    if (nextSession) {
      storeSession(nextSession);
    }
  };

  const clearReconnectAttempt = () => {
    reconnectAttemptRef.current = null;
  };

  const clearChatState = ({ preserveDraft = false }: { preserveDraft?: boolean } = {}) => {
    const pendingText = chatPendingTextRef.current;

    setChatMessages([]);
    setChatError(null);
    setPendingChatText(null);
    setChatDraftState((current) => {
      if (preserveDraft) {
        return current || pendingText || "";
      }

      return "";
    });
  };

  const clearTransientRoomState = ({
    preserveChatDraft = false
  }: { preserveChatDraft?: boolean } = {}) => {
    setMatch(null);
    setBombArmed(false);
    clearChatState({ preserveDraft: preserveChatDraft });
    pendingEventsRef.current = [];
  };

  const invalidateRoomSession = (roomCode: string, message: string) => {
    removeStoredSession(roomCode);

    if (
      sessionRef.current?.roomCode === roomCode ||
      reconnectAttemptRef.current?.roomCode === roomCode
    ) {
      setClientSession(null);
      clearTransientRoomState();
    }

    clearReconnectAttempt();
    setError(message);
  };

  const connectSocket = () => {
    const socket = socketRef.current;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const nextSocket = new WebSocket(SERVER_URL);
    socketRef.current = nextSocket;
    setConnectionStatus("connecting");

    nextSocket.addEventListener("open", () => {
      if (socketRef.current !== nextSocket) {
        nextSocket.close();
        return;
      }

      setConnectionStatus("connected");

      const reconnectSession = reconnectAttemptRef.current ?? sessionRef.current;

      if (reconnectSession) {
        reconnectAttemptRef.current = reconnectSession;
        nextSocket.send(JSON.stringify(buildReconnectEvent(reconnectSession)));
      }

      for (const queuedEvent of pendingEventsRef.current.splice(0)) {
        nextSocket.send(JSON.stringify(queuedEvent));
      }
    });

    nextSocket.addEventListener("message", (message) => {
      if (socketRef.current !== nextSocket) {
        return;
      }

      const event = decodeServerEvent(message.data);

      if (!event) {
        setError("The server sent an unreadable event.");
        return;
      }

      const activeRoomCode =
        reconnectAttemptRef.current?.roomCode ?? sessionRef.current?.roomCode ?? null;

      if (!shouldApplyServerEvent(event, activeRoomCode)) {
        return;
      }

      switch (event.type) {
        case SERVER_EVENT_NAMES.roomCreated:
        case SERVER_EVENT_NAMES.roomJoined: {
          clearReconnectAttempt();
          const nextSession = buildSessionFromRoomEvent(event);
          setClientSession(nextSession);
          clearTransientRoomState();
          setError(null);
          break;
        }
        case SERVER_EVENT_NAMES.roomState: {
          const reconnectSession = reconnectAttemptRef.current;

          if (reconnectSession && reconnectSession.roomCode === event.payload.roomCode) {
            clearReconnectAttempt();
            setClientSession({
              ...reconnectSession,
              roomId: event.payload.roomId,
              players: event.payload.players
            });
            setBombArmed(false);
            setError(null);
            break;
          }

          setSession((current) => {
            if (!current || current.roomCode !== event.payload.roomCode) {
              return current;
            }

            const nextSession = {
              ...current,
              roomId: event.payload.roomId,
              players: event.payload.players
            };
            sessionRef.current = nextSession;
            storeSession(nextSession);
            return nextSession;
          });
          break;
        }
        case SERVER_EVENT_NAMES.chatHistory: {
          const activeSession = sessionRef.current;
          const pendingText = chatPendingTextRef.current;

          setChatMessages(replaceChatHistory(event.payload.messages));

          if (
            pendingText &&
            activeSession &&
            event.payload.messages.some(
              (message) =>
                message.playerId === activeSession.playerId && message.text === pendingText
            )
          ) {
            setPendingChatText(null);
          }
          break;
        }
        case SERVER_EVENT_NAMES.chatMessage:
          setChatMessages((current) => appendChatMessage(current, event.payload.message));

          if (sessionRef.current?.playerId === event.payload.message.playerId) {
            setPendingChatText(null);
            setChatError(null);
          }
          break;
        case SERVER_EVENT_NAMES.chatMessageRejected: {
          const pendingText = chatPendingTextRef.current;

          if (pendingText) {
            setChatDraftState(pendingText);
            setPendingChatText(null);
          }

          setChatError(event.payload.message);
          break;
        }
        case SERVER_EVENT_NAMES.matchStarted:
        case SERVER_EVENT_NAMES.matchState:
        case SERVER_EVENT_NAMES.matchEnded:
          setMatch(event.payload.match);
          setBombArmed(false);
          break;
        case SERVER_EVENT_NAMES.matchRematchUpdated:
          setMatch((current) =>
            current ? updateRematchState(current, event.payload.players) : current
          );
          break;
        case SERVER_EVENT_NAMES.matchActionRejected:
          setError(event.payload.message);
          setBombArmed(false);
          break;
        case SERVER_EVENT_NAMES.serverError: {
          const reconnectSession = reconnectAttemptRef.current;

          if (reconnectSession) {
            invalidateRoomSession(
              reconnectSession.roomCode,
              "Your saved room session is no longer valid. Join the room again."
            );
            break;
          }

          setError(event.payload.message);
          setBombArmed(false);
          break;
        }
        case SERVER_EVENT_NAMES.playerDisconnected:
        case SERVER_EVENT_NAMES.playerReconnected:
          break;
      }
    });

    nextSocket.addEventListener("close", () => {
      if (socketRef.current !== nextSocket) {
        return;
      }

      if (chatPendingTextRef.current) {
        setChatDraftState((current) => current || chatPendingTextRef.current || "");
        setPendingChatText(null);
      }

      socketRef.current = null;
      setConnectionStatus("disconnected");

      if (!shouldReconnectRef.current) {
        return;
      }

      clearReconnectTimer();
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectSocket();
      }, 1000);
    });
  };

  const restartSocket = () => {
    clearReconnectTimer();

    const currentSocket = socketRef.current;
    shouldReconnectRef.current = false;
    socketRef.current = null;
    setConnectionStatus("disconnected");

    if (
      currentSocket &&
      (currentSocket.readyState === WebSocket.OPEN || currentSocket.readyState === WebSocket.CONNECTING)
    ) {
      currentSocket.close();
    }

    shouldReconnectRef.current = true;
    connectSocket();
  };

  const sendEvent = (event: ClientEvent) => {
    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
      return true;
    }

    if (shouldQueueWhileOffline(event)) {
      pendingEventsRef.current = [event];
      connectSocket();
      return true;
    }

    setError("Connection lost. Reconnecting before your next action.");
    connectSocket();
    return false;
  };

  useEffect(() => {
    shouldReconnectRef.current = true;
    connectSocket();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      socketRef.current?.close();
    };
  }, []);

  const clearActiveRoomState = () => {
    clearReconnectAttempt();
    setClientSession(null);
    clearTransientRoomState();
    setError(null);
  };

  const startLobbyTransition = () => {
    const hadActiveSession = sessionRef.current !== null;
    clearActiveRoomState();

    if (hadActiveSession) {
      restartSocket();
    }
  };

  const createRoom = (displayName: string) => {
    startLobbyTransition();
    sendEvent({
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName }
    });
  };

  const joinRoom = (displayName: string, roomCode: string) => {
    startLobbyTransition();
    sendEvent({
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: { displayName, roomCode }
    });
  };

  const reconnect = (roomCode: string) => {
    const storedSession = getStoredSession(roomCode);

    if (!storedSession) {
      setError("No local session is stored for that room.");
      return;
    }

    if (reconnectAttemptRef.current?.roomCode === storedSession.roomCode) {
      return;
    }

    const previousRoomCode = sessionRef.current?.roomCode ?? null;
    reconnectAttemptRef.current = storedSession;

    if (sessionRef.current?.roomCode !== storedSession.roomCode) {
      setClientSession(null);
    }

    clearTransientRoomState({
      preserveChatDraft: previousRoomCode === storedSession.roomCode
    });
    setError(null);

    const reconnectEvent = buildReconnectEvent(storedSession);
    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
      if (previousRoomCode && previousRoomCode !== storedSession.roomCode) {
        restartSocket();
        return;
      }

      socket.send(JSON.stringify(reconnectEvent));
      return;
    }

    connectSocket();
  };

  const withSession = <T,>(callback: (activeSession: StoredSession) => T): T | undefined => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      return undefined;
    }

    return callback(activeSession);
  };

  const submitCellAction = (row: number, column: number) => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setError("Join a room before sending actions.");
      return;
    }

    const action = bombArmed
      ? { type: "bomb" as const, row, column }
      : { type: "select" as const, row, column };

    if (
      sendEvent({
        type: CLIENT_EVENT_NAMES.matchAction,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken,
          action
        }
      })
    ) {
      setBombArmed(false);
    }
  };

  const sendChatMessage = () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setChatError("Join a room before chatting.");
      return;
    }

    if (chatPendingTextRef.current) {
      return;
    }

    if (!chatDraft.trim()) {
      setChatError("Type a message before sending.");
      return;
    }

    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN || connectionStatus !== "connected") {
      setChatError("Chat is reconnecting. Try again once the room reconnects.");
      connectSocket();
      return;
    }

    const nextDraft = chatDraft;

    setPendingChatText(nextDraft);
    setChatDraftState("");
    setChatError(null);

    try {
      socket.send(
        JSON.stringify({
          type: CLIENT_EVENT_NAMES.chatSend,
          payload: {
            roomCode: activeSession.roomCode,
            sessionToken: activeSession.sessionToken,
            text: nextDraft
          }
        })
      );
    } catch {
      setChatDraftState(nextDraft);
      setPendingChatText(null);
      setChatError("Chat could not be sent. Try again.");
    }
  };

  const requestRematch = () => {
    withSession((activeSession) =>
      sendEvent({
        type: CLIENT_EVENT_NAMES.matchRematchRequest,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken
        }
      })
    );
  };

  const cancelRematch = () => {
    withSession((activeSession) =>
      sendEvent({
        type: CLIENT_EVENT_NAMES.matchRematchCancel,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken
        }
      })
    );
  };

  const resignMatch = () => {
    withSession((activeSession) => {
      setError(null);
      setBombArmed(false);
      sendEvent({
        type: CLIENT_EVENT_NAMES.matchResign,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken
        }
      });
    });
  };

  const openLobby = () => {
    clearActiveRoomState();
    restartSocket();
  };

  return (
    <GameClientContext.Provider
      value={{
        connectionStatus,
        error,
        session,
        match,
        bombArmed,
        chatMessages,
        chatError,
        chatDraft,
        chatPending: chatPendingText !== null,
        openLobby,
        createRoom,
        joinRoom,
        reconnect,
        submitCellAction,
        setChatDraft,
        sendChatMessage,
        toggleBombMode: () => setBombArmed((current) => !current),
        resignMatch,
        requestRematch,
        cancelRematch,
        clearError: () => setError(null)
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
