import { z } from "zod";
import { coordinateSchema, displayNameSchema, playerIdSchema } from "./primitives.js";

export const cellStatusSchema = z.enum(["hidden", "revealed", "claimed", "mine-revealed"]);

export const boardCellDtoSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  status: cellStatusSchema,
  adjacentMines: z.number().int().min(0).nullable(),
  claimedByPlayerId: playerIdSchema.nullable()
});

export const boardStateDtoSchema = z.object({
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  mineCount: z.number().int().positive(),
  cells: z.array(z.array(boardCellDtoSchema))
});

export const playerMatchDtoSchema = z.object({
  playerId: playerIdSchema,
  displayName: displayNameSchema,
  score: z.number().int().min(0),
  bombsRemaining: z.union([z.literal(0), z.literal(1)]),
  connected: z.boolean(),
  rematchRequested: z.boolean()
});

export const resolvedActionDtoSchema = z.object({
  type: z.enum(["select", "bomb"]),
  playerId: playerIdSchema,
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  outcome: z.enum(["mine_claimed", "safe_reveal", "bomb_used"]),
  revealedCount: z.number().int().min(0),
  claimedMineCount: z.number().int().min(0),
  claimedMineCoordinates: z.array(coordinateSchema).optional()
});

export const matchStateDtoSchema = z.object({
  roomId: z.string().min(1),
  phase: z.enum(["waiting", "live", "finished"]),
  board: boardStateDtoSchema,
  players: z.tuple([playerMatchDtoSchema, playerMatchDtoSchema]),
  currentTurnPlayerId: playerIdSchema.nullable(),
  turnPhase: z.enum(["awaiting_action", "ended"]),
  turnNumber: z.number().int().positive(),
  winnerPlayerId: playerIdSchema.nullable(),
  lastAction: resolvedActionDtoSchema.nullable()
});

export type BoardCellDto = z.infer<typeof boardCellDtoSchema>;
export type BoardStateDto = z.infer<typeof boardStateDtoSchema>;
export type MatchStateDto = z.infer<typeof matchStateDtoSchema>;
export type PlayerMatchDto = z.infer<typeof playerMatchDtoSchema>;

