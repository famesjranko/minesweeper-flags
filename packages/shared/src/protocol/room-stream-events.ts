import { SERVER_EVENT_NAMES } from "./event-names.js";
import type { ServerEvent } from "./server-to-client.schema.js";

export type RoomStreamEvent = Extract<
  ServerEvent,
  {
    type:
      | typeof SERVER_EVENT_NAMES.roomState
      | typeof SERVER_EVENT_NAMES.chatMessage
      | typeof SERVER_EVENT_NAMES.matchStarted
      | typeof SERVER_EVENT_NAMES.matchState
      | typeof SERVER_EVENT_NAMES.matchEnded
      | typeof SERVER_EVENT_NAMES.matchRematchUpdated
      | typeof SERVER_EVENT_NAMES.playerDisconnected
      | typeof SERVER_EVENT_NAMES.playerReconnected;
  }
>;
