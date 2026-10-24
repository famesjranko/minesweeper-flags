import {
  encodeServerEvent,
  SERVER_EVENT_NAMES,
  type ServerEvent,
  serverEventSchema
} from "@minesweeper-flags/shared";
import type { WebSocket } from "ws";

export const sendEvent = (socket: WebSocket, event: ServerEvent): void => {
  const wire = encodeServerEvent(event);
  serverEventSchema.parse(wire);
  socket.send(JSON.stringify(wire));
};

export const sendServerError = (socket: WebSocket, message: string): void => {
  sendEvent(socket, {
    type: SERVER_EVENT_NAMES.serverError,
    payload: {
      message
    }
  });
};
