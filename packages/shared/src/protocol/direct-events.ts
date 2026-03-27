import { SERVER_EVENT_NAMES } from "./event-names.js";
import type { ServerEvent } from "./server-to-client.schema.js";

export type DirectServerEvent = Extract<
  ServerEvent,
  {
    type:
      | typeof SERVER_EVENT_NAMES.roomCreated
      | typeof SERVER_EVENT_NAMES.roomJoined
      | typeof SERVER_EVENT_NAMES.chatHistory
      | typeof SERVER_EVENT_NAMES.chatMessageRejected
      | typeof SERVER_EVENT_NAMES.matchActionRejected
      | typeof SERVER_EVENT_NAMES.serverError;
  }
>;
