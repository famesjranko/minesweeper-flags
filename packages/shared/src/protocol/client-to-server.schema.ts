import { z } from "zod";
import { coordinateSchema, displayNameSchema, roomCodeSchema, sessionTokenSchema } from "../schemas/primitives.js";
import { CLIENT_EVENT_NAMES } from "./event-names.js";

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("select"),
    row: coordinateSchema.shape.row,
    column: coordinateSchema.shape.column
  }),
  z.object({
    type: z.literal("bomb"),
    row: coordinateSchema.shape.row,
    column: coordinateSchema.shape.column
  })
]);

export const roomCreateEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.roomCreate),
  payload: z.object({
    displayName: displayNameSchema
  })
});

export const roomJoinEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.roomJoin),
  payload: z.object({
    roomCode: roomCodeSchema,
    displayName: displayNameSchema
  })
});

export const chatSendEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.chatSend),
  payload: z.object({
    roomCode: roomCodeSchema,
    sessionToken: sessionTokenSchema,
    text: z.string()
  })
});

export const matchActionEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.matchAction),
  payload: z.object({
    roomCode: roomCodeSchema,
    sessionToken: sessionTokenSchema,
    action: actionSchema
  })
});

export const matchResignEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.matchResign),
  payload: z.object({
    roomCode: roomCodeSchema,
    sessionToken: sessionTokenSchema
  })
});

export const matchRematchRequestEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.matchRematchRequest),
  payload: z.object({
    roomCode: roomCodeSchema,
    sessionToken: sessionTokenSchema
  })
});

export const matchRematchCancelEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.matchRematchCancel),
  payload: z.object({
    roomCode: roomCodeSchema,
    sessionToken: sessionTokenSchema
  })
});

export const playerReconnectEventSchema = z.object({
  type: z.literal(CLIENT_EVENT_NAMES.playerReconnect),
  payload: z.object({
    roomCode: roomCodeSchema,
    sessionToken: sessionTokenSchema
  })
});

export const clientEventSchema = z.discriminatedUnion("type", [
  roomCreateEventSchema,
  roomJoinEventSchema,
  chatSendEventSchema,
  matchActionEventSchema,
  matchResignEventSchema,
  matchRematchRequestEventSchema,
  matchRematchCancelEventSchema,
  playerReconnectEventSchema
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;
