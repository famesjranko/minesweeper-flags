import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type ChatMessageDto,
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
  chatMessages: ChatMessageDto[];
  chatDraft: string;
  chatError: string | null;
  chatPendingText: string | null;
  pendingEvents: ClientEvent[];
}

export const createLobbyRuntimeState = (): LobbyRuntimeState => ({
  session: null,
  match: null,
  bombArmed: false,
  error: null,
  chatMessages: [],
  chatDraft: "",
  chatError: null,
  chatPendingText: null,
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

export const replaceChatHistory = (messages: ChatMessageDto[]): ChatMessageDto[] => {
  const seenMessageIds = new Set<string>();
  const nextMessages: ChatMessageDto[] = [];

  for (const message of messages) {
    if (seenMessageIds.has(message.messageId)) {
      continue;
    }

    seenMessageIds.add(message.messageId);
    nextMessages.push(message);
  }

  return nextMessages;
};

export const appendChatMessage = (
  messages: ChatMessageDto[],
  message: ChatMessageDto
): ChatMessageDto[] => {
  if (messages.some((entry) => entry.messageId === message.messageId)) {
    return messages;
  }

  return [...messages, message];
};

export const hasDeliveredChatText = (
  messages: ChatMessageDto[],
  playerId: string,
  text: string
): boolean =>
  messages.some((message) => message.playerId === playerId && message.text === text);

export const reconcileRecoveredChatDraft = ({
  currentDraft,
  recoveredDraftText,
  playerId,
  messages
}: {
  currentDraft: string;
  recoveredDraftText: string | null;
  playerId: string | null;
  messages: ChatMessageDto[];
}): {
  nextDraft: string;
  shouldClearRecoveredDraft: boolean;
} => {
  if (!recoveredDraftText || !playerId) {
    return {
      nextDraft: currentDraft,
      shouldClearRecoveredDraft: false
    };
  }

  if (!hasDeliveredChatText(messages, playerId, recoveredDraftText)) {
    return {
      nextDraft: currentDraft,
      shouldClearRecoveredDraft: false
    };
  }

  return {
    nextDraft: currentDraft === recoveredDraftText ? "" : currentDraft,
    shouldClearRecoveredDraft: true
  };
};

export const getServerEventRoomCode = (event: ServerEvent): string | null => {
  switch (event.type) {
    case SERVER_EVENT_NAMES.roomState:
    case SERVER_EVENT_NAMES.chatHistory:
    case SERVER_EVENT_NAMES.chatMessage:
    case SERVER_EVENT_NAMES.chatMessageRejected:
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
