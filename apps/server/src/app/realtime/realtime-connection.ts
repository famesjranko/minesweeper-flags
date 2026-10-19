import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { createId } from "../../lib/ids/id.js";
import { logger } from "../../lib/logging/logger.js";
import { TRUST_PROXY } from "../config/env.js";
import type { StateStores } from "../state/state-store.js";
import { resolveClientAddress } from "./client-address.js";
import type { DispatchExecution } from "./execution-dispatcher.js";
import type { PlayerSession } from "./player-session.service.js";
import type { RealtimeMessageRouter, SocketContext } from "./realtime-message-router.js";
import type { RealtimeServices } from "./realtime-services.js";
import { sendServerError } from "./socket-events.js";
import type { SocketHeartbeatMonitor } from "./socket-heartbeat.js";

interface ConnectionHandlerDependencies {
  services: RealtimeServices;
  stateStores: StateStores;
  socketContexts: WeakMap<WebSocket, SocketContext>;
  heartbeatMonitor: SocketHeartbeatMonitor;
  dispatchExecution: DispatchExecution;
  messageRouter: RealtimeMessageRouter;
}

const getCloseReason = (reasonBuffer: Buffer): string | undefined => {
  const reason = reasonBuffer.toString();

  return reason ? reason : undefined;
};

/**
 * Owns each WebSocket connection from open to close: admission, session refresh
 * on heartbeat, and disconnect handling that removes rooms nobody is connected to.
 */
export class RealtimeConnectionHandler {
  constructor(private readonly dependencies: ConnectionHandlerDependencies) {}

  accept(socket: WebSocket, request: IncomingMessage): void {
    const { abusePrevention } = this.dependencies.services;
    const remoteAddress = resolveClientAddress(request, { trustProxy: TRUST_PROXY });
    const context: SocketContext = {
      connectionId: createId(),
      remoteAddress,
      openedAt: Date.now()
    };
    const connectionAdmission = abusePrevention.registerConnection(remoteAddress);

    this.dependencies.socketContexts.set(socket, context);
    this.dependencies.heartbeatMonitor.attach(socket);
    socket.on("pong", () => this.refreshSessionOnPong(socket, context));

    logger.info("realtime.connection_opened", {
      connectionId: context.connectionId,
      remoteAddress,
      activeConnections: connectionAdmission.activeConnections
    });

    socket.on("error", (error) => {
      logger.warn("realtime.socket_error", {
        connectionId: context.connectionId,
        remoteAddress,
        error
      });
    });
    socket.on("close", (code, reasonBuffer) => {
      this.handleClose(socket, context, code, reasonBuffer);
    });

    if (!connectionAdmission.allowed) {
      logger.warn("realtime.connection_rejected", {
        connectionId: context.connectionId,
        remoteAddress,
        reason: "connection_limit",
        activeConnections: connectionAdmission.activeConnections,
        limit: connectionAdmission.limit
      });
      sendServerError(socket, "Too many open connections from this IP address. Try again later.");
      socket.close(1008, "Connection limit exceeded");
      return;
    }

    socket.on("message", (message) => {
      void this.dependencies.messageRouter.handle(socket, context, message);
    });
  }

  private refreshSessionOnPong(socket: WebSocket, context: SocketContext): void {
    const { connectionRegistry, playerSessionService, roomService } = this.dependencies.services;
    const session = connectionRegistry.getSessionForSocket(socket);

    if (!session) {
      return;
    }

    void (async () => {
      await playerSessionService.refreshSession(session);
      await roomService.touchRoomActivity(session.roomCode);
    })().catch((error) => {
      logger.error("realtime.session_refresh_failed", {
        error,
        connectionId: context.connectionId,
        remoteAddress: context.remoteAddress,
        roomCode: session.roomCode,
        playerId: session.playerId
      });
    });
  }

  private handleClose(
    socket: WebSocket,
    context: SocketContext,
    code: number,
    reasonBuffer: Buffer
  ): void {
    const { abusePrevention, connectionRegistry } = this.dependencies.services;

    abusePrevention.unregisterConnection(context.remoteAddress);

    const session = connectionRegistry.detachIfCurrent(socket);

    logger.info("realtime.connection_closed", {
      connectionId: context.connectionId,
      remoteAddress: context.remoteAddress,
      roomCode: session?.roomCode,
      playerId: session?.playerId,
      closeCode: code,
      closeReason: getCloseReason(reasonBuffer),
      connectionDurationMs: Date.now() - context.openedAt,
      activeConnections: abusePrevention.getActiveConnections(context.remoteAddress)
    });

    if (session) {
      this.disconnectSession(session, context);
    }
  }

  private disconnectSession(session: PlayerSession, context: SocketContext): void {
    const { commandService } = this.dependencies.services;

    void (async () => {
      await this.dependencies.dispatchExecution(
        null,
        await commandService.disconnectPlayer(session)
      );
      await this.deleteRoomIfAbandoned(session.roomCode);
    })().catch((error) => {
      logger.error("realtime.connection_close_failed", {
        error,
        connectionId: context.connectionId,
        remoteAddress: context.remoteAddress,
        roomCode: session.roomCode,
        playerId: session.playerId
      });
    });
  }

  private async deleteRoomIfAbandoned(roomCode: string): Promise<void> {
    const { connectionRegistry, playerSessionService, roomTaskRunner } = this.dependencies.services;
    const { stateStores } = this.dependencies;
    const { roomRepository, matchRepository, chatRepository } = stateStores;

    await roomTaskRunner.run(roomCode, async () => {
      const room = await roomRepository.getByCode(roomCode);

      if (!room) {
        return;
      }

      const hasActiveConnection = room.players.some((player) => {
        const playerSocket = connectionRegistry.getSocketForPlayer(player.playerId);
        return playerSocket && playerSocket.readyState === WebSocket.OPEN;
      });

      if (hasActiveConnection) {
        return;
      }

      const deleteRoomState =
        stateStores.deleteRoomState ??
        (async () => {
          await roomRepository.delete(room.roomCode);
          await matchRepository.deleteByRoomId(room.roomId);
          await chatRepository.deleteByRoomCode(room.roomCode);
          await playerSessionService.revokeRoomSessions(room.roomCode);
        });

      await deleteRoomState(room);

      logger.info("realtime.empty_room_cleaned_up", {
        roomId: room.roomId,
        roomCode: room.roomCode,
        playerCount: room.players.length
      });
    });
  }
}
