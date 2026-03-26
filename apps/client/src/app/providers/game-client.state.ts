import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type ClientEvent,
  type MatchStateDto,
  type ServerEvent
} from "@minesweeper-flags/shared";
import type { StoredSession } from "../../lib/socket/session-storage.js";

export interface PlayerIdentity {
  playerId: string;
  displayName: string;
}

export interface ClientSession extends StoredSession {
  players: PlayerIdentity[];
}

export interface LobbyRuntimeState {
  session: ClientSession | null;
  match: MatchStateDto | null;
  bombArmed: boolean;
  error: string | null;
  pendingEvents: ClientEvent[];
}

export const createLobbyRuntimeState = (): LobbyRuntimeState => ({
  session: null,
  match: null,
  bombArmed: false,
  error: null,
  pendingEvents: []
});

export const buildReconnectEvent = (session: StoredSession): ClientEvent => ({
  type: CLIENT_EVENT_NAMES.playerReconnect,
  payload: {
    roomCode: session.roomCode,
    sessionToken: session.sessionToken
  }
});

export const buildSessionFromRoomEvent = (
  event: Extract<ServerEvent, { type: "room:created" | "room:joined" }>
): ClientSession => ({
  roomId: event.payload.roomId,
  roomCode: event.payload.roomCode,
  playerId: event.payload.self.playerId,
  displayName: event.payload.self.displayName,
  sessionToken: event.payload.self.sessionToken,
  players: event.payload.players
});

export const shouldQueueWhileOffline = (event: ClientEvent): boolean =>
  event.type === CLIENT_EVENT_NAMES.roomCreate || event.type === CLIENT_EVENT_NAMES.roomJoin;

export const getServerEventRoomCode = (event: ServerEvent): string | null => {
  switch (event.type) {
    case SERVER_EVENT_NAMES.roomState:
    case SERVER_EVENT_NAMES.matchStarted:
    case SERVER_EVENT_NAMES.matchState:
    case SERVER_EVENT_NAMES.matchEnded:
    case SERVER_EVENT_NAMES.matchRematchUpdated:
    case SERVER_EVENT_NAMES.playerDisconnected:
    case SERVER_EVENT_NAMES.playerReconnected:
      return event.payload.roomCode;
    case SERVER_EVENT_NAMES.matchActionRejected:
      return event.payload.roomCode ?? null;
    default:
      return null;
  }
};

export const shouldApplyServerEvent = (
  event: ServerEvent,
  activeRoomCode: string | null
): boolean => {
  if (event.type === SERVER_EVENT_NAMES.roomCreated || event.type === SERVER_EVENT_NAMES.roomJoined) {
    return true;
  }

  const roomCode = getServerEventRoomCode(event);

  if (!roomCode) {
    return true;
  }

  return activeRoomCode === roomCode;
};
