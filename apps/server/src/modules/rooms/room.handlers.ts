import type WebSocket from "ws";
import { SERVER_EVENT_NAMES, type ServerEvent } from "@minesweeper-flags/shared";
import type { MatchService } from "../matches/match.service.js";
import type { RoomService } from "./room.service.js";
import type { PlayerSession } from "../../app/realtime/player-session.service.js";
import { logger } from "../../lib/logging/logger.js";

interface RoomHandlerDependencies {
  roomService: RoomService;
  matchService: MatchService;
  createSession: (
    roomCode: string,
    player: { playerId: string; displayName: string }
  ) => Promise<PlayerSession>;
  attachSessionSocket: (session: PlayerSession, socket: WebSocket) => Promise<void>;
  sendEvent: (socket: WebSocket, event: ServerEvent) => void;
  sendChatHistory: (socket: WebSocket, roomCode: string) => Promise<void>;
  broadcastToRoom: (roomCode: string, event: ServerEvent) => Promise<void>;
}

export const handleRoomCreate = async (
  socket: WebSocket,
  displayName: string,
  dependencies: RoomHandlerDependencies
): Promise<void> => {
  const { room, player } = await dependencies.roomService.createRoom(displayName);

  if (!room.inviteToken) {
    throw new Error("Created rooms must include an invite token.");
  }

  const session = await dependencies.createSession(room.roomCode, player);
  await dependencies.attachSessionSocket(session, socket);

  logger.info("room.created", {
    roomId: room.roomId,
    roomCode: room.roomCode,
    playerId: session.playerId
  });

  dependencies.sendEvent(socket, {
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
      players: room.players
    }
  });
  await dependencies.sendChatHistory(socket, room.roomCode);
};

export const handleRoomJoin = async (
  socket: WebSocket,
  inviteToken: string,
  displayName: string,
  dependencies: RoomHandlerDependencies
): Promise<void> => {
  const { room, player } = await dependencies.roomService.joinRoomByInviteToken(
    inviteToken,
    displayName
  );
  const session = await dependencies.createSession(room.roomCode, player);
  await dependencies.attachSessionSocket(session, socket);

  logger.info("room.joined", {
    roomId: room.roomId,
    roomCode: room.roomCode,
    playerId: session.playerId,
    playerCount: room.players.length
  });

  const joinedEvent: ServerEvent = {
    type: SERVER_EVENT_NAMES.roomJoined,
    payload: {
      roomId: room.roomId,
      roomCode: room.roomCode,
      self: {
        playerId: session.playerId,
        displayName: session.displayName,
        sessionToken: session.sessionToken
      },
      players: room.players
    }
  };

  dependencies.sendEvent(socket, joinedEvent);
  await dependencies.sendChatHistory(socket, room.roomCode);
  await dependencies.broadcastToRoom(room.roomCode, {
    type: SERVER_EVENT_NAMES.roomState,
    payload: {
      roomId: room.roomId,
      roomCode: room.roomCode,
      players: room.players
    }
  });

  const startedMatch = await dependencies.matchService.startMatchForRoom(room, Date.now());

  await dependencies.broadcastToRoom(room.roomCode, {
    type: SERVER_EVENT_NAMES.matchStarted,
    payload: {
      roomCode: room.roomCode,
      match: startedMatch.dto
    }
  });
};
