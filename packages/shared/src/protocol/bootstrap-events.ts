import { SERVER_EVENT_NAMES } from "./event-names.js";
import type { ServerEvent } from "./server-to-client.schema.js";

export type BootstrapServerEvent = Extract<
  ServerEvent,
  {
    type:
      | typeof SERVER_EVENT_NAMES.roomCreated
      | typeof SERVER_EVENT_NAMES.roomJoined
      | typeof SERVER_EVENT_NAMES.roomState
      | typeof SERVER_EVENT_NAMES.chatHistory;
  }
>;
