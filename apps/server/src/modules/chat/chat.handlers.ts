import type WebSocket from "ws";
import { SERVER_EVENT_NAMES, type ServerEvent } from "@minesweeper-flags/shared";
import type { PlayerSession } from "../../app/realtime/player-session.service.js";
import { logger } from "../../lib/logging/logger.js";
import type { RoomService } from "../rooms/room.service.js";
import type { ChatService } from "./chat.service.js";

interface ChatHandlerDependencies {
  chatService: ChatService;
  roomService: RoomService;
  sendEvent: (socket: WebSocket, event: ServerEvent) => void;
  broadcastToRoom: (roomCode: string, event: ServerEvent) => Promise<void>;
}

export const sendChatHistory = async (
  socket: WebSocket,
  roomCode: string,
  dependencies: ChatHandlerDependencies
): Promise<void> => {
  const messages = await dependencies.chatService.listRecentMessages(roomCode);

  dependencies.sendEvent(socket, {
    type: SERVER_EVENT_NAMES.chatHistory,
    payload: {
      roomCode,
      messages
    }
  });
};

export const sendChatRejected = (
  socket: WebSocket,
  roomCode: string,
  message: string,
  dependencies: Pick<ChatHandlerDependencies, "sendEvent">
): void => {
  dependencies.sendEvent(socket, {
    type: SERVER_EVENT_NAMES.chatMessageRejected,
    payload: {
      roomCode,
      message
    }
  });
};

export const handleChatSend = async (
  socket: WebSocket,
  session: PlayerSession,
  text: string,
  dependencies: ChatHandlerDependencies
): Promise<void> => {
  try {
    const message = await dependencies.chatService.sendMessage(
      session.roomCode,
      {
        playerId: session.playerId,
        displayName: session.displayName
      },
      text,
      Date.now()
    );

    await dependencies.roomService.touchRoomActivity(session.roomCode, message.sentAt);
    await dependencies.broadcastToRoom(session.roomCode, {
      type: SERVER_EVENT_NAMES.chatMessage,
      payload: {
        roomCode: session.roomCode,
        message
      }
    });
  } catch (error) {
    logger.warn("chat.message_rejected", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      reason: error instanceof Error ? error.message : "Chat message rejected."
    });

    sendChatRejected(
      socket,
      session.roomCode,
      error instanceof Error ? error.message : "Chat message rejected.",
      dependencies
    );
  }
};
