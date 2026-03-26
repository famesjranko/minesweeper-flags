import { z } from "zod";
import { chatMessageDtoSchema } from "../schemas/chat.schema.js";
import { matchStateDtoSchema, playerMatchDtoSchema } from "../schemas/match.schema.js";
import {
  displayNameSchema,
  playerIdSchema,
  roomCodeSchema,
  sessionTokenSchema
} from "../schemas/primitives.js";
import { SERVER_EVENT_NAMES } from "./event-names.js";

const playerIdentitySchema = z.object({
  playerId: playerIdSchema,
  displayName: displayNameSchema
});

const playerSessionSchema = playerIdentitySchema.extend({
  sessionToken: sessionTokenSchema
});

export const roomCreatedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.roomCreated),
  payload: z.object({
    roomId: z.string().min(1),
    roomCode: roomCodeSchema,
    self: playerSessionSchema,
    players: z.array(playerIdentitySchema)
  })
});

export const roomJoinedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.roomJoined),
  payload: z.object({
    roomId: z.string().min(1),
    roomCode: roomCodeSchema,
    self: playerSessionSchema,
    players: z.array(playerIdentitySchema)
  })
});

export const roomStateEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.roomState),
  payload: z.object({
    roomId: z.string().min(1),
    roomCode: roomCodeSchema,
    players: z.array(playerIdentitySchema)
  })
});

export const chatHistoryEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.chatHistory),
  payload: z.object({
    roomCode: roomCodeSchema,
    messages: z.array(chatMessageDtoSchema)
  })
});

export const chatMessageEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.chatMessage),
  payload: z.object({
    roomCode: roomCodeSchema,
    message: chatMessageDtoSchema
  })
});

export const chatMessageRejectedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.chatMessageRejected),
  payload: z.object({
    roomCode: roomCodeSchema,
    message: z.string().min(1)
  })
});

export const matchStartedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.matchStarted),
  payload: z.object({
    roomCode: roomCodeSchema,
    match: matchStateDtoSchema
  })
});

export const matchStateEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.matchState),
  payload: z.object({
    roomCode: roomCodeSchema,
    match: matchStateDtoSchema
  })
});

export const matchActionRejectedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.matchActionRejected),
  payload: z.object({
    roomCode: roomCodeSchema.optional(),
    message: z.string().min(1)
  })
});

export const matchEndedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.matchEnded),
  payload: z.object({
    roomCode: roomCodeSchema,
    match: matchStateDtoSchema
  })
});

export const matchRematchUpdatedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.matchRematchUpdated),
  payload: z.object({
    roomCode: roomCodeSchema,
    players: z.array(
      playerMatchDtoSchema.pick({
        playerId: true,
        rematchRequested: true
      })
    ),
    readyCount: z.number().int().min(0).max(2)
  })
});

export const playerDisconnectedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.playerDisconnected),
  payload: z.object({
    roomCode: roomCodeSchema,
    playerId: playerIdSchema
  })
});

export const playerReconnectedEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.playerReconnected),
  payload: z.object({
    roomCode: roomCodeSchema,
    playerId: playerIdSchema
  })
});

export const serverErrorEventSchema = z.object({
  type: z.literal(SERVER_EVENT_NAMES.serverError),
  payload: z.object({
    message: z.string().min(1)
  })
});

export const serverEventSchema = z.discriminatedUnion("type", [
  roomCreatedEventSchema,
  roomJoinedEventSchema,
  roomStateEventSchema,
  chatHistoryEventSchema,
  chatMessageEventSchema,
  chatMessageRejectedEventSchema,
  matchStartedEventSchema,
  matchStateEventSchema,
  matchActionRejectedEventSchema,
  matchEndedEventSchema,
  matchRematchUpdatedEventSchema,
  playerDisconnectedEventSchema,
  playerReconnectedEventSchema,
  serverErrorEventSchema
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
