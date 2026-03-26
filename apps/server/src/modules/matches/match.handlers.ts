import type WebSocket from "ws";
import {
  SERVER_EVENT_NAMES,
  type ServerEvent,
  actionSchema
} from "@minesweeper-flags/shared";
import type { z } from "zod";
import type { MatchService } from "./match.service.js";
import type { RoomService } from "../rooms/room.service.js";
import type { PlayerSession } from "../../app/realtime/player-session.service.js";
import { logger } from "../../lib/logging/logger.js";

type MatchActionPayload = z.infer<typeof actionSchema>;

interface MatchHandlerDependencies {
  roomService: RoomService;
  matchService: MatchService;
  attachSessionSocket: (session: PlayerSession, socket: WebSocket) => Promise<void>;
  sendEvent: (socket: WebSocket, event: ServerEvent) => void;
  sendRoomState: (socket: WebSocket, roomCode: string) => Promise<void>;
  broadcastToRoom: (roomCode: string, event: ServerEvent) => Promise<void>;
}

export const handleMatchAction = async (
  socket: WebSocket,
  session: PlayerSession,
  action: MatchActionPayload,
  dependencies: MatchHandlerDependencies
): Promise<void> => {
  try {
    const result = await dependencies.matchService.applyAction(
      session.roomCode,
      session.playerId,
      action,
      Date.now()
    );
    await dependencies.roomService.touchRoomActivity(session.roomCode, result.state.updatedAt);
    await dependencies.broadcastToRoom(result.roomCode, {
      type: result.state.phase === "finished" ? SERVER_EVENT_NAMES.matchEnded : SERVER_EVENT_NAMES.matchState,
      payload: {
        roomCode: result.roomCode,
        match: result.dto
      }
    });
  } catch (error) {
    logger.warn("match.action_rejected", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      reason: error instanceof Error ? error.message : "The action was rejected."
    });
    dependencies.sendEvent(socket, {
      type: SERVER_EVENT_NAMES.matchActionRejected,
      payload: {
        roomCode: session.roomCode,
        message: error instanceof Error ? error.message : "The action was rejected."
      }
    });
  }
};

export const handleMatchResign = async (
  socket: WebSocket,
  session: PlayerSession,
  dependencies: MatchHandlerDependencies
): Promise<void> => {
  try {
    const result = await dependencies.matchService.resign(
      session.roomCode,
      session.playerId,
      Date.now()
    );
    await dependencies.roomService.touchRoomActivity(session.roomCode, result.state.updatedAt);
    await dependencies.broadcastToRoom(result.roomCode, {
      type: SERVER_EVENT_NAMES.matchEnded,
      payload: {
        roomCode: result.roomCode,
        match: result.dto
      }
    });
  } catch (error) {
    logger.warn("match.resign_rejected", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      reason: error instanceof Error ? error.message : "The resign action was rejected."
    });
    dependencies.sendEvent(socket, {
      type: SERVER_EVENT_NAMES.matchActionRejected,
      payload: {
        roomCode: session.roomCode,
        message: error instanceof Error ? error.message : "The resign action was rejected."
      }
    });
  }
};

export const handleReconnect = async (
  socket: WebSocket,
  session: PlayerSession,
  dependencies: MatchHandlerDependencies
): Promise<void> => {
  const room = await dependencies.roomService.getRoomByCode(session.roomCode);
  await dependencies.roomService.touchRoomActivity(session.roomCode);

  if (!room.players.find((player) => player.playerId === session.playerId)) {
    throw new Error("That player is not part of this room.");
  }

  await dependencies.attachSessionSocket(session, socket);
  const updated = await dependencies.matchService.setConnectionState(
    session.roomCode,
    session.playerId,
    true
  );
  await dependencies.sendRoomState(socket, session.roomCode);

  await dependencies.broadcastToRoom(session.roomCode, {
    type: SERVER_EVENT_NAMES.playerReconnected,
    payload: {
      roomCode: session.roomCode,
      playerId: session.playerId
    }
  });

  logger.info("realtime.player_reconnected", {
    roomCode: session.roomCode,
    playerId: session.playerId
  });

  if (updated) {
    await dependencies.broadcastToRoom(session.roomCode, {
      type: SERVER_EVENT_NAMES.matchState,
      payload: {
        roomCode: session.roomCode,
        match: updated.dto
      }
    });
  }
};

export const handleSocketClosed = async (
  session: PlayerSession,
  dependencies: MatchHandlerDependencies
): Promise<void> => {
  const room = await dependencies.roomService.getRoomByPlayerId(session.playerId);

  if (!room) {
    return;
  }

  await dependencies.roomService.touchRoomActivity(room.roomCode);

  const updated = await dependencies.matchService.setConnectionState(
    room.roomCode,
    session.playerId,
    false
  );

  await dependencies.broadcastToRoom(room.roomCode, {
    type: SERVER_EVENT_NAMES.playerDisconnected,
    payload: {
      roomCode: room.roomCode,
      playerId: session.playerId
    }
  });

  logger.info("realtime.player_disconnected", {
    roomCode: room.roomCode,
    playerId: session.playerId
  });

  if (updated) {
    await dependencies.broadcastToRoom(room.roomCode, {
      type: SERVER_EVENT_NAMES.matchState,
      payload: {
        roomCode: room.roomCode,
        match: updated.dto
      }
    });
  }
};
