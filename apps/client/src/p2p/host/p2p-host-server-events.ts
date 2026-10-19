import type { MatchState } from "@minesweeper-flags/game-engine";
import {
  type ChatMessageDto,
  SERVER_EVENT_NAMES,
  type ServerEvent,
  toMatchStateDto
} from "@minesweeper-flags/shared";
import type { P2PGuestSessionRecord, P2PHostSessionRecord } from "./p2p-host-session.js";
import type { P2PHostRoomRecord, P2PRoomPlayerRecord } from "./p2p-host-state.js";

// Builders for the server events the host orchestrator fans out. Each one copies the
// records it reads, so no event shares mutable state with the orchestrator.

const cloneRoomPlayers = (players: readonly P2PRoomPlayerRecord[]): P2PRoomPlayerRecord[] =>
  players.map((player) => ({ ...player }));

const cloneChatMessages = (messages: readonly ChatMessageDto[]): ChatMessageDto[] =>
  messages.map((message) => ({ ...message }));

export const buildRoomCreatedEvent = (
  room: P2PHostRoomRecord,
  session: P2PHostSessionRecord
): ServerEvent => {
  if (!room.inviteToken) {
    throw new Error("Created rooms must include an invite token.");
  }

  return {
    type: SERVER_EVENT_NAMES.roomCreated,
    payload: {
      roomId: room.roomId,
      roomCode: room.roomCode,
      inviteToken: room.inviteToken,
      self: {
        playerId: session.playerId,
        displayName: session.displayName,
        sessionToken: session.sessionToken
      },
      players: cloneRoomPlayers(room.players)
    }
  };
};

export const buildRoomJoinedEvent = (
  room: P2PHostRoomRecord,
  session: P2PGuestSessionRecord
): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.roomJoined,
    payload: {
      roomId: room.roomId,
      roomCode: room.roomCode,
      self: {
        playerId: session.playerId,
        displayName: session.displayName,
        sessionToken: session.sessionToken
      },
      players: cloneRoomPlayers(room.players)
    }
  };
};

export const buildRoomStateEvent = (room: P2PHostRoomRecord): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.roomState,
    payload: {
      roomId: room.roomId,
      roomCode: room.roomCode,
      players: cloneRoomPlayers(room.players)
    }
  };
};

export const buildChatHistoryEvent = (
  roomCode: string,
  messages: readonly ChatMessageDto[]
): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.chatHistory,
    payload: {
      roomCode,
      messages: cloneChatMessages(messages)
    }
  };
};

export const buildChatMessageEvent = (roomCode: string, message: ChatMessageDto): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.chatMessage,
    payload: {
      roomCode,
      message: { ...message }
    }
  };
};

export const buildChatRejectedEvent = (roomCode: string, message: string): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.chatMessageRejected,
    payload: {
      roomCode,
      message
    }
  };
};

export const buildMatchActionRejectedEvent = (roomCode: string, message: string): ServerEvent => ({
  type: SERVER_EVENT_NAMES.matchActionRejected,
  payload: {
    roomCode,
    message
  }
});

export const buildMatchStartedEvent = (roomCode: string, match: MatchState): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.matchStarted,
    payload: {
      roomCode,
      match: toMatchStateDto(match)
    }
  };
};

export const buildMatchStateEvent = (roomCode: string, match: MatchState): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.matchState,
    payload: {
      roomCode,
      match: toMatchStateDto(match)
    }
  };
};

export const buildMatchEndedEvent = (roomCode: string, match: MatchState): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.matchEnded,
    payload: {
      roomCode,
      match: toMatchStateDto(match)
    }
  };
};

export const buildRematchUpdatedEvent = (
  roomCode: string,
  match: MatchState,
  readyCount: number
): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.matchRematchUpdated,
    payload: {
      roomCode,
      players: match.players.map((player) => ({
        playerId: player.playerId,
        rematchRequested: player.rematchRequested
      })),
      readyCount
    }
  };
};

// A reconnecting player receives the match event that matches its phase, as on first join.
export const buildMatchReplayEvent = (roomCode: string, match: MatchState): ServerEvent => {
  if (match.phase === "finished") {
    return buildMatchEndedEvent(roomCode, match);
  }

  return match.lastAction === null
    ? buildMatchStartedEvent(roomCode, match)
    : buildMatchStateEvent(roomCode, match);
};

export const buildPlayerDisconnectedEvent = (roomCode: string, playerId: string): ServerEvent => ({
  type: SERVER_EVENT_NAMES.playerDisconnected,
  payload: {
    roomCode,
    playerId
  }
});

export const buildPlayerReconnectedEvent = (roomCode: string, playerId: string): ServerEvent => {
  return {
    type: SERVER_EVENT_NAMES.playerReconnected,
    payload: {
      roomCode,
      playerId
    }
  };
};
