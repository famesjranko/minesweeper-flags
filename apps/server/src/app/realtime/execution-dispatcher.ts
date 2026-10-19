import {
  type ServerEvent,
  WEBSOCKET_CLOSE_CODES,
  WEBSOCKET_CLOSE_REASONS
} from "@minesweeper-flags/shared";
import { WebSocket } from "ws";
import type { RoomService } from "../../modules/rooms/room.service.js";
import type { GameCommandService } from "../commands/game-command.service.js";
import type { CommandExecution } from "../commands/game-command.types.js";
import type { ConnectionRegistry } from "./connection.registry.js";
import type { PlayerSession } from "./player-session.service.js";
import { sendEvent } from "./socket-events.js";

export type DispatchExecution = (
  socket: WebSocket | null,
  execution: CommandExecution
) => Promise<void>;

interface ExecutionDispatcherDependencies {
  roomService: RoomService;
  commandService: GameCommandService;
  connectionRegistry: ConnectionRegistry;
}

/**
 * Delivers a command execution: binds the caller's session, then sends each step
 * to the caller or to every connected player in the room. `socket` is null when
 * the server acts on its own, such as after a disconnect.
 */
export const createExecutionDispatcher = ({
  roomService,
  commandService,
  connectionRegistry
}: ExecutionDispatcherDependencies): DispatchExecution => {
  const broadcastToRoom = async (roomCode: string, event: ServerEvent) => {
    const room = await roomService.getRoomByCode(roomCode);

    for (const player of room.players) {
      const socket = connectionRegistry.getSocketForPlayer(player.playerId);

      if (socket && socket.readyState === WebSocket.OPEN) {
        sendEvent(socket, event);
      }
    }
  };

  async function dispatchExecution(
    socket: WebSocket | null,
    execution: CommandExecution
  ): Promise<void> {
    if (execution.sessionToBind) {
      if (!socket) {
        throw new Error("A caller socket is required to bind a session.");
      }

      await attachSessionSocket(execution.sessionToBind, socket);
    }

    for (const step of execution.steps) {
      if (step.kind === "direct") {
        if (!socket) {
          throw new Error("A caller socket is required to send direct events.");
        }

        sendEvent(socket, step.event);
        continue;
      }

      await broadcastToRoom(step.roomCode, step.event);
    }
  }

  async function attachSessionSocket(session: PlayerSession, socket: WebSocket) {
    const { displacedSession, replacedSocket } = connectionRegistry.attach(session, socket);

    if (displacedSession) {
      await dispatchExecution(null, await commandService.disconnectPlayer(displacedSession));
    }

    if (replacedSocket && replacedSocket.readyState !== WebSocket.CLOSED) {
      replacedSocket.close(
        WEBSOCKET_CLOSE_CODES.sessionReplaced,
        WEBSOCKET_CLOSE_REASONS.sessionReplaced
      );
    }
  }

  return dispatchExecution;
};
