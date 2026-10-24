import {
  CLIENT_EVENT_NAMES,
  type ClientEvent,
  clientEventSchema,
  SERVER_EVENT_NAMES
} from "@minesweeper-flags/shared";
import type { RawData, WebSocket } from "ws";
import { logger } from "../../lib/logging/logger.js";
import type { GameCommandService } from "../commands/game-command.service.js";
import { MAX_WEBSOCKET_MESSAGE_BYTES } from "../config/env.js";
import type { ConnectionRegistry } from "./connection.registry.js";
import type { DispatchExecution } from "./execution-dispatcher.js";
import type { PlayerSessionService } from "./player-session.service.js";
import type { RealtimeAbusePrevention } from "./realtime-abuse-prevention.js";
import type { RealtimeLifecycle } from "./realtime-lifecycle.js";
import { requireAttachedSession } from "./session-auth.js";
import { sendEvent, sendServerError } from "./socket-events.js";
import { getRawMessageByteLength } from "./websocket-admission.js";

export interface SocketContext {
  connectionId: string;
  remoteAddress: string;
  openedAt: number;
}

type ClientEventOf<Type extends ClientEvent["type"]> = Extract<ClientEvent, { type: Type }>;

interface SessionCredentials {
  roomCode: string;
  sessionToken: string;
}

interface MessageRouterDependencies {
  lifecycle: Readonly<RealtimeLifecycle>;
  abusePrevention: RealtimeAbusePrevention;
  commandService: GameCommandService;
  connectionRegistry: ConnectionRegistry;
  playerSessionService: PlayerSessionService;
  dispatchExecution: DispatchExecution;
}

const rawDataToString = (message: RawData): string => {
  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return Buffer.concat(message).toString();
  }

  if (message instanceof ArrayBuffer) {
    return Buffer.from(message).toString();
  }

  return Buffer.from(message as Uint8Array).toString();
};

/**
 * Validates one inbound WebSocket message and routes it to the command service.
 * Admission checks (readiness, size, schema, rate limits) run before any command.
 */
export class RealtimeMessageRouter {
  constructor(private readonly dependencies: MessageRouterDependencies) {}

  async handle(socket: WebSocket, context: SocketContext, message: RawData): Promise<void> {
    let eventType: string | undefined;

    try {
      if (this.dependencies.lifecycle.state !== "ready") {
        logger.warn("realtime.request_rejected", {
          connectionId: context.connectionId,
          remoteAddress: context.remoteAddress,
          reason: "server_not_ready"
        });
        sendServerError(socket, "The server is shutting down.");
        socket.close(1001, "Server shutting down");
        return;
      }

      const messageByteLength = getRawMessageByteLength(message);

      if (messageByteLength > MAX_WEBSOCKET_MESSAGE_BYTES) {
        logger.warn("realtime.message_rejected", {
          connectionId: context.connectionId,
          remoteAddress: context.remoteAddress,
          reason: "message_too_large",
          messageByteLength,
          limit: MAX_WEBSOCKET_MESSAGE_BYTES
        });
        socket.close(1009, "Message too large");
        return;
      }

      const parsedMessage = JSON.parse(rawDataToString(message)) as unknown;
      const parsedEvent = clientEventSchema.safeParse(parsedMessage);

      if (!parsedEvent.success) {
        this.rejectInvalidEvent(socket, context);
        return;
      }

      eventType = parsedEvent.data.type;
      await this.route(socket, context, parsedEvent.data);
    } catch (error) {
      logger.error("realtime.message_failed", {
        error,
        connectionId: context.connectionId,
        remoteAddress: context.remoteAddress,
        eventType
      });

      sendServerError(socket, error instanceof Error ? error.message : "Unexpected server error.");
    }
  }

  private async route(
    socket: WebSocket,
    context: SocketContext,
    event: ClientEvent
  ): Promise<void> {
    const { commandService, dispatchExecution } = this.dependencies;

    switch (event.type) {
      case CLIENT_EVENT_NAMES.roomCreate:
        await this.handleRoomCreate(socket, context, event);
        break;
      case CLIENT_EVENT_NAMES.roomJoin:
        await this.handleRoomJoin(socket, context, event);
        break;
      case CLIENT_EVENT_NAMES.roomCancel: {
        const session = await this.requireSession(socket, event.payload);
        await dispatchExecution(
          socket,
          await commandService.cancelRoom(session, event.payload.requestId)
        );
        this.dependencies.connectionRegistry.detachIfCurrent(socket);
        break;
      }
      case CLIENT_EVENT_NAMES.chatSend:
        await this.handleChatSend(socket, context, event);
        break;
      case CLIENT_EVENT_NAMES.matchAction: {
        const session = await this.requireSession(socket, event.payload);
        await dispatchExecution(
          socket,
          await commandService.applyMatchAction(session, event.payload.action)
        );
        break;
      }
      case CLIENT_EVENT_NAMES.matchResign: {
        const session = await this.requireSession(socket, event.payload);
        await dispatchExecution(socket, await commandService.resignMatch(session));
        break;
      }
      case CLIENT_EVENT_NAMES.playerReconnect:
        await dispatchExecution(
          socket,
          await commandService.reconnectPlayer(event.payload.roomCode, event.payload.sessionToken)
        );
        break;
      case CLIENT_EVENT_NAMES.matchRematchRequest: {
        const session = await this.requireSession(socket, event.payload);
        await dispatchExecution(socket, await commandService.requestRematch(session));
        break;
      }
      case CLIENT_EVENT_NAMES.matchRematchCancel: {
        const session = await this.requireSession(socket, event.payload);
        await dispatchExecution(socket, await commandService.cancelRematch(session));
        break;
      }
    }
  }

  private requireSession(socket: WebSocket, { roomCode, sessionToken }: SessionCredentials) {
    return requireAttachedSession(this.dependencies, roomCode, sessionToken, socket);
  }

  private rejectInvalidEvent(socket: WebSocket, context: SocketContext): void {
    const invalidMessageResult = this.dependencies.abusePrevention.recordInvalidMessage(
      context.remoteAddress
    );

    logger.warn("realtime.invalid_client_event", {
      connectionId: context.connectionId,
      remoteAddress: context.remoteAddress,
      invalidMessageRemaining: invalidMessageResult.remaining,
      retryAfterMs: invalidMessageResult.retryAfterMs
    });

    sendServerError(
      socket,
      invalidMessageResult.allowed
        ? "The message format is invalid."
        : "Too many invalid messages. Reconnect and try again."
    );

    if (!invalidMessageResult.allowed) {
      socket.close(1008, "Invalid message limit exceeded");
    }
  }

  private async handleRoomCreate(
    socket: WebSocket,
    context: SocketContext,
    event: ClientEventOf<typeof CLIENT_EVENT_NAMES.roomCreate>
  ): Promise<void> {
    const { abusePrevention, commandService, dispatchExecution } = this.dependencies;
    const roomCreateResult = abusePrevention.consumeRoomCreate(context.remoteAddress);

    if (!roomCreateResult.allowed) {
      logger.warn("realtime.room_create_rate_limited", {
        connectionId: context.connectionId,
        remoteAddress: context.remoteAddress,
        retryAfterMs: roomCreateResult.retryAfterMs,
        limit: roomCreateResult.limit
      });
      sendServerError(socket, "Too many room creation attempts. Try again in a moment.");
      return;
    }

    const attachedSession = this.dependencies.connectionRegistry.getSessionForSocket(socket);
    const previousSession =
      attachedSession &&
      this.dependencies.connectionRegistry.isCurrentSocket(attachedSession.playerId, socket)
        ? attachedSession
        : undefined;

    await dispatchExecution(
      socket,
      await commandService.createRoom(
        event.payload.displayName,
        event.payload.boardSize,
        previousSession
      )
    );
  }

  private async handleRoomJoin(
    socket: WebSocket,
    context: SocketContext,
    event: ClientEventOf<typeof CLIENT_EVENT_NAMES.roomJoin>
  ): Promise<void> {
    const { abusePrevention, commandService, dispatchExecution } = this.dependencies;
    const roomJoinResult = abusePrevention.consumeRoomJoin(context.remoteAddress);

    if (!roomJoinResult.allowed) {
      logger.warn("realtime.room_join_rate_limited", {
        connectionId: context.connectionId,
        remoteAddress: context.remoteAddress,
        retryAfterMs: roomJoinResult.retryAfterMs,
        limit: roomJoinResult.limit
      });
      sendServerError(socket, "Too many room join attempts. Try again in a moment.");
      return;
    }

    await dispatchExecution(
      socket,
      await commandService.joinRoom(event.payload.inviteToken, event.payload.displayName)
    );
  }

  private async handleChatSend(
    socket: WebSocket,
    context: SocketContext,
    event: ClientEventOf<typeof CLIENT_EVENT_NAMES.chatSend>
  ): Promise<void> {
    const { abusePrevention, commandService, dispatchExecution } = this.dependencies;
    const session = await this.requireSession(socket, event.payload);
    const chatRateLimitResult = abusePrevention.consumeChatMessage(session.playerId);

    if (!chatRateLimitResult.allowed) {
      logger.warn("realtime.chat_message_rate_limited", {
        connectionId: context.connectionId,
        remoteAddress: context.remoteAddress,
        roomCode: session.roomCode,
        playerId: session.playerId,
        retryAfterMs: chatRateLimitResult.retryAfterMs,
        limit: chatRateLimitResult.limit
      });
      sendEvent(socket, {
        type: SERVER_EVENT_NAMES.chatMessageRejected,
        payload: {
          roomCode: session.roomCode,
          message: "You're sending messages too quickly. Try again in a moment."
        }
      });
      return;
    }

    await dispatchExecution(socket, await commandService.sendChat(session, event.payload.text));
  }
}
