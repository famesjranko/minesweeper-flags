import type WebSocket from "ws";
import { SERVER_EVENT_NAMES, type ServerEvent } from "@minesweeper-flags/shared";
import type { RematchService } from "./rematch.service.js";
import type { PlayerSession } from "../../app/realtime/player-session.service.js";
import { logger } from "../../lib/logging/logger.js";
import type { RoomService } from "../rooms/room.service.js";

interface RematchHandlerDependencies {
  rematchService: RematchService;
  roomService: RoomService;
  sendEvent: (socket: WebSocket, event: ServerEvent) => void;
  broadcastToRoom: (roomCode: string, event: ServerEvent) => Promise<void>;
}

export const handleRematchRequest = async (
  socket: WebSocket,
  session: PlayerSession,
  dependencies: RematchHandlerDependencies
): Promise<void> => {
  try {
    const result = await dependencies.rematchService.requestRematch(
      session.roomCode,
      session.playerId,
      Date.now()
    );
    await dependencies.roomService.touchRoomActivity(session.roomCode);
    await dependencies.broadcastToRoom(session.roomCode, {
      type: SERVER_EVENT_NAMES.matchRematchUpdated,
      payload: {
        roomCode: session.roomCode,
        players: result.players,
        readyCount: result.readyCount
      }
    });

    if (result.match) {
      await dependencies.broadcastToRoom(session.roomCode, {
        type: SERVER_EVENT_NAMES.matchStarted,
        payload: {
          roomCode: session.roomCode,
          match: result.match
        }
      });
    }
  } catch (error) {
    logger.warn("match.rematch_request_rejected", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      reason: error instanceof Error ? error.message : "Rematch failed."
    });
    dependencies.sendEvent(socket, {
      type: SERVER_EVENT_NAMES.serverError,
      payload: {
        message: error instanceof Error ? error.message : "Rematch failed."
      }
    });
  }
};

export const handleRematchCancel = async (
  socket: WebSocket,
  session: PlayerSession,
  dependencies: RematchHandlerDependencies
): Promise<void> => {
  try {
    const result = await dependencies.rematchService.cancelRematch(
      session.roomCode,
      session.playerId
    );
    await dependencies.roomService.touchRoomActivity(session.roomCode);
    await dependencies.broadcastToRoom(session.roomCode, {
      type: SERVER_EVENT_NAMES.matchRematchUpdated,
      payload: {
        roomCode: session.roomCode,
        players: result.players,
        readyCount: result.readyCount
      }
    });
  } catch (error) {
    logger.warn("match.rematch_cancel_rejected", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      reason: error instanceof Error ? error.message : "Rematch update failed."
    });
    dependencies.sendEvent(socket, {
      type: SERVER_EVENT_NAMES.serverError,
      payload: {
        message: error instanceof Error ? error.message : "Rematch update failed."
      }
    });
  }
};
