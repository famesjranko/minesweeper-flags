import { SERVER_EVENT_NAMES, type ServerEvent, serverEventSchema } from "@minesweeper-flags/shared";
import type { WebSocket } from "ws";

export const sendEvent = (socket: WebSocket, event: ServerEvent): void => {
  const parsed = serverEventSchema.parse(event);
  socket.send(JSON.stringify(parsed));
};

export const sendServerError = (socket: WebSocket, message: string): void => {
  sendEvent(socket, {
    type: SERVER_EVENT_NAMES.serverError,
    payload: {
      message
    }
  });
};
