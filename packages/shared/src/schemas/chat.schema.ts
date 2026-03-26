import { z } from "zod";
import { displayNameSchema, playerIdSchema } from "./primitives.js";

export const chatMessageDtoSchema = z.object({
  messageId: z.string().min(1),
  playerId: playerIdSchema,
  displayName: displayNameSchema,
  text: z.string().min(1),
  sentAt: z.number().int().nonnegative()
});

export type ChatMessageDto = z.infer<typeof chatMessageDtoSchema>;
