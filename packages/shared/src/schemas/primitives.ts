import { z } from "zod";

export const roomCodeSchema = z.string().trim().min(4).max(8).transform((value) => value.toUpperCase());
export const playerIdSchema = z.string().min(1);
export const sessionTokenSchema = z.string().min(1);
export const displayNameSchema = z.string().trim().min(1).max(20);
export const coordinateSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0)
});
