import { z } from "zod";
import { INVITE_TOKEN_LENGTH } from "../constants/game.constants.js";

export const roomCodeSchema = z.string().trim().min(4).max(8).transform((value) => value.toUpperCase());
export const inviteTokenSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^[A-Za-z0-9_-]{${INVITE_TOKEN_LENGTH}}$`));
export const playerIdSchema = z.string().min(1);
export const sessionTokenSchema = z.string().min(1);
export const displayNameSchema = z.string().trim().min(1).max(20);
export const coordinateSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0)
});
