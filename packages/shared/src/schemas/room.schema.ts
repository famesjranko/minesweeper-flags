import { z } from "zod";
import { displayNameSchema, playerIdSchema, roomCodeSchema } from "./primitives.js";

export const playerSummarySchema = z.object({
  playerId: playerIdSchema,
  displayName: displayNameSchema
});

export const roomSummarySchema = z.object({
  roomId: z.string().min(1),
  roomCode: roomCodeSchema,
  players: z.tuple([playerSummarySchema, playerSummarySchema.optional()]).transform((players) =>
    players.filter(Boolean)
  )
});

