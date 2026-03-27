import { CLIENT_EVENT_NAMES } from "./event-names.js";
import type { ClientEvent } from "./client-to-server.schema.js";

export type GameCommand = ClientEvent;

export type CreateRoomCommand = Extract<GameCommand, { type: typeof CLIENT_EVENT_NAMES.roomCreate }>;
export type JoinRoomCommand = Extract<GameCommand, { type: typeof CLIENT_EVENT_NAMES.roomJoin }>;
export type SendChatCommand = Extract<GameCommand, { type: typeof CLIENT_EVENT_NAMES.chatSend }>;
export type ApplyMatchActionCommand = Extract<
  GameCommand,
  { type: typeof CLIENT_EVENT_NAMES.matchAction }
>;
export type ResignMatchCommand = Extract<
  GameCommand,
  { type: typeof CLIENT_EVENT_NAMES.matchResign }
>;
export type RequestRematchCommand = Extract<
  GameCommand,
  { type: typeof CLIENT_EVENT_NAMES.matchRematchRequest }
>;
export type CancelRematchCommand = Extract<
  GameCommand,
  { type: typeof CLIENT_EVENT_NAMES.matchRematchCancel }
>;
export type ReconnectPlayerCommand = Extract<
  GameCommand,
  { type: typeof CLIENT_EVENT_NAMES.playerReconnect }
>;

export type RoomBootstrapCommand = CreateRoomCommand | JoinRoomCommand;
export type SessionCommand = Exclude<GameCommand, RoomBootstrapCommand>;
