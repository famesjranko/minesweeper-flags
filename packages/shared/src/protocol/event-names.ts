export const CLIENT_EVENT_NAMES = {
  roomCreate: "room:create",
  roomJoin: "room:join",
  matchAction: "match:action",
  matchResign: "match:resign",
  matchRematchRequest: "match:rematch-request",
  matchRematchCancel: "match:rematch-cancel",
  playerReconnect: "player:reconnect"
} as const;

export const SERVER_EVENT_NAMES = {
  roomCreated: "room:created",
  roomJoined: "room:joined",
  roomState: "room:state",
  matchStarted: "match:started",
  matchState: "match:state",
  matchActionRejected: "match:action-rejected",
  matchEnded: "match:ended",
  matchRematchUpdated: "match:rematch-updated",
  playerDisconnected: "player:disconnected",
  playerReconnected: "player:reconnected",
  serverError: "server:error"
} as const;
