import type { BoardState } from "@minesweeper-flags/game-engine";
import { z } from "zod";

export const P2P_RECOVERY_STORAGE_VERSION = 1;

// Leaf primitives. The hand-rolled guards only checked typeof === "string"
// (allowing empty strings), but the plan accepts tightening identifier-like
// fields to non-empty. Empty text bodies are still allowed for chat messages.
const nonEmptyString = z.string().min(1);
const nullableNonEmptyString = nonEmptyString.nullable();
const optionalNonEmptyString = nonEmptyString.optional();
const integerSchema = z.number().int();
// The previous hand-rolled guard only checked `typeof value === "number"` for
// seed/createdAt/updatedAt/sentAt — not integer. Preserve that.
const timestampSchema = z.number();

const playerIdentitySchema = z.object({
  playerId: nonEmptyString,
  displayName: nonEmptyString
});

// chat text previously used isString (allows empty). Preserve — z.string().
const chatMessageSchema = z.object({
  messageId: nonEmptyString,
  playerId: nonEmptyString,
  displayName: nonEmptyString,
  text: z.string(),
  sentAt: timestampSchema
});

const boardCellSchema = z.object({
  row: integerSchema,
  column: integerSchema,
  hasMine: z.boolean(),
  adjacentMines: integerSchema,
  isRevealed: z.boolean(),
  claimedByPlayerId: nullableNonEmptyString
});

export const boardStateSchema = z
  .object({
    rows: integerSchema,
    columns: integerSchema,
    mineCount: integerSchema,
    cells: z.array(z.array(boardCellSchema))
  })
  .superRefine((value, ctx) => {
    if (value.cells.length !== value.rows) {
      ctx.addIssue({
        code: "custom",
        message: "Board cells row count must match rows"
      });
      return;
    }
    for (let rowIndex = 0; rowIndex < value.cells.length; rowIndex += 1) {
      const row = value.cells[rowIndex];
      if (!row || row.length !== value.columns) {
        ctx.addIssue({
          code: "custom",
          message: "Board cells column count must match columns"
        });
        return;
      }
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        const cell = row[columnIndex];
        if (!cell || cell.row !== rowIndex || cell.column !== columnIndex) {
          ctx.addIssue({
            code: "custom",
            message: "Board cell coordinates must match grid position"
          });
          return;
        }
      }
    }
  });

// Compile-time guard: schema must remain structurally compatible with the
// engine's BoardState. If packages/game-engine adds a required field to
// BoardState or BoardCell without a schema update, this function fails to
// type-check. Not added for matchStateSchema because z's `.optional()` widens
// to `T | undefined` which conflicts with `exactOptionalPropertyTypes` against
// MatchState.lastAction.claimedMineCoordinates.
const _assertBoardStateAlignment = (value: z.infer<typeof boardStateSchema>): BoardState => value;
void _assertBoardStateAlignment;

const playerMatchStateSchema = z.object({
  playerId: nonEmptyString,
  displayName: nonEmptyString,
  score: integerSchema,
  bombsRemaining: z.union([z.literal(0), z.literal(1)]),
  connected: z.boolean(),
  rematchRequested: z.boolean()
});

const resolvedActionSchema = z.object({
  type: z.enum(["select", "bomb"]),
  playerId: nonEmptyString,
  row: integerSchema,
  column: integerSchema,
  outcome: z.enum(["mine_claimed", "safe_reveal", "bomb_used"]),
  revealedCount: integerSchema,
  claimedMineCount: integerSchema,
  claimedMineCoordinates: z
    .array(z.object({ row: integerSchema, column: integerSchema }))
    .optional()
});

export const matchStateSchema = z
  .object({
    roomId: nonEmptyString,
    phase: z.enum(["live", "finished"]),
    board: boardStateSchema,
    currentTurnPlayerId: nullableNonEmptyString,
    turnPhase: z.enum(["awaiting_action", "ended"]),
    turnNumber: integerSchema.min(1),
    winnerPlayerId: nullableNonEmptyString,
    lastAction: resolvedActionSchema.nullable(),
    seed: timestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    players: z.tuple([playerMatchStateSchema, playerMatchStateSchema])
  })
  .superRefine((value, ctx) => {
    const playerIds = [value.players[0].playerId, value.players[1].playerId];

    if (value.currentTurnPlayerId !== null && !playerIds.includes(value.currentTurnPlayerId)) {
      ctx.addIssue({
        code: "custom",
        message: "currentTurnPlayerId must belong to one of the match players"
      });
    }

    if (value.winnerPlayerId !== null && !playerIds.includes(value.winnerPlayerId)) {
      ctx.addIssue({
        code: "custom",
        message: "winnerPlayerId must belong to one of the match players"
      });
    }

    if (value.lastAction !== null && !playerIds.includes(value.lastAction.playerId)) {
      ctx.addIssue({
        code: "custom",
        message: "lastAction.playerId must belong to one of the match players"
      });
    }

    const livePhaseValid =
      value.phase === "live" &&
      value.turnPhase === "awaiting_action" &&
      value.currentTurnPlayerId !== null &&
      value.winnerPlayerId === null;
    const finishedPhaseValid =
      value.phase === "finished" &&
      value.turnPhase === "ended" &&
      value.currentTurnPlayerId === null;

    if (!livePhaseValid && !finishedPhaseValid) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid match phase / turnPhase combination"
      });
    }
  });

const hostRoomRecordSchema = z.object({
  roomId: nonEmptyString,
  roomCode: nonEmptyString,
  inviteToken: nullableNonEmptyString,
  players: z.array(playerIdentitySchema),
  nextStarterIndex: z.union([z.literal(0), z.literal(1)]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

const hostSessionRecordSchema = z.object({
  role: z.literal("host"),
  roomId: nonEmptyString,
  roomCode: nonEmptyString,
  playerId: nonEmptyString,
  displayName: nonEmptyString,
  sessionToken: nonEmptyString
});

const guestSessionRecordSchema = z.object({
  role: z.literal("guest"),
  roomId: nonEmptyString,
  roomCode: nonEmptyString,
  playerId: nonEmptyString,
  displayName: nonEmptyString,
  sessionToken: nonEmptyString,
  bindingId: nullableNonEmptyString
});

const guestReconnectMetadataSchema = z.object({
  controlSessionId: nonEmptyString,
  guestSecret: nonEmptyString,
  lastInstanceId: optionalNonEmptyString
});

export const hostReconnectMetadataSchema = z.object({
  controlSessionId: nonEmptyString,
  hostSecret: nonEmptyString,
  guestSecret: nullableNonEmptyString,
  lastInstanceId: optionalNonEmptyString
});

/**
 * Structural shape used by the cross-field refinement. We deliberately use a
 * minimal inline type instead of importing P2PHostRoomRecord / MatchState /
 * etc. so the callback stays assignable to both hostAuthoritySnapshotSchema
 * (where room/hostSession/... are nullable) and hostRecoveryRecordSchema
 * (where room/hostSession are non-null) without fighting `exactOptionalPropertyTypes`
 * drift between the zod-inferred shapes and the engine interfaces.
 */
interface HostAuthorityRefinementInput {
  room: {
    roomId: string;
    roomCode: string;
    players: { playerId: string; displayName: string }[];
  } | null;
  hostSession: {
    roomId: string;
    roomCode: string;
    playerId: string;
    displayName: string;
    sessionToken: string;
  } | null;
  guestSession: {
    roomId: string;
    roomCode: string;
    playerId: string;
    displayName: string;
    sessionToken: string;
  } | null;
  match: {
    roomId: string;
    players: readonly [
      { playerId: string; displayName: string },
      { playerId: string; displayName: string }
    ];
  } | null;
}

/**
 * Cross-field rules that apply to any host-authority shape (both the stored
 * recovery record and the looser runtime snapshot passed to
 * validateHostAuthoritySnapshot). Factoring into a helper keeps the rules in a
 * single place so the two consumers can't drift.
 */
const checkHostAuthorityRelationships = (
  value: HostAuthorityRefinementInput,
  ctx: z.RefinementCtx
): void => {
  const { room, hostSession, guestSession, match } = value;

  // Rule 1: room and hostSession are linked — both present or both null.
  if ((room === null) !== (hostSession === null)) {
    ctx.addIssue({
      code: "custom",
      message: "room and hostSession must both be present or both null"
    });
    return;
  }

  // Rule 2: guestSession requires a room.
  if (guestSession !== null && room === null) {
    ctx.addIssue({
      code: "custom",
      message: "guestSession requires a room"
    });
    return;
  }

  // Rule 3: match requires room, hostSession, and guestSession all present.
  if (
    match !== null &&
    (room === null || hostSession === null || guestSession === null)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "match requires room, hostSession, and guestSession"
    });
    return;
  }

  // Rule 4: room/hostSession parity.
  if (
    room !== null &&
    hostSession !== null &&
    (hostSession.roomId !== room.roomId || hostSession.roomCode !== room.roomCode)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "hostSession must match room roomId/roomCode"
    });
    return;
  }

  // Rule 5: room/guestSession parity.
  if (
    room !== null &&
    guestSession !== null &&
    (guestSession.roomId !== room.roomId || guestSession.roomCode !== room.roomCode)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "guestSession must match room roomId/roomCode"
    });
    return;
  }

  // Rule 6: hostSession identity must be present in room.players.
  if (
    room !== null &&
    hostSession !== null &&
    !room.players.some(
      (player) =>
        player.playerId === hostSession.playerId &&
        player.displayName === hostSession.displayName
    )
  ) {
    ctx.addIssue({
      code: "custom",
      message: "room.players must contain hostSession identity"
    });
    return;
  }

  // Rule 7: solo room must have exactly one player.
  if (
    room !== null &&
    hostSession !== null &&
    guestSession === null &&
    room.players.length !== 1
  ) {
    ctx.addIssue({
      code: "custom",
      message: "room without guestSession must contain exactly one player"
    });
    return;
  }

  // Rule 8: guestSession identity must be present in room.players.
  if (
    room !== null &&
    guestSession !== null &&
    !room.players.some(
      (player) =>
        player.playerId === guestSession.playerId &&
        player.displayName === guestSession.displayName
    )
  ) {
    ctx.addIssue({
      code: "custom",
      message: "room.players must contain guestSession identity"
    });
    return;
  }

  // Rule 9: hostSession and guestSession must have distinct identities.
  if (
    hostSession !== null &&
    guestSession !== null &&
    (hostSession.playerId === guestSession.playerId ||
      hostSession.sessionToken === guestSession.sessionToken)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "hostSession and guestSession must have distinct playerId and sessionToken"
    });
    return;
  }

  // Rule 10: full room must have exactly two unique players.
  if (
    room !== null &&
    hostSession !== null &&
    guestSession !== null &&
    (room.players.length !== 2 ||
      new Set(room.players.map((player) => player.playerId)).size !== room.players.length)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "full room must contain exactly two uniquely identified players"
    });
    return;
  }

  // Rule 11: match must reference the current room and both players.
  if (
    match !== null &&
    room !== null &&
    hostSession !== null &&
    guestSession !== null &&
    (match.roomId !== room.roomId ||
      match.players[0].playerId === match.players[1].playerId ||
      !match.players.some(
        (player) =>
          player.playerId === hostSession.playerId &&
          player.displayName === hostSession.displayName
      ) ||
      !match.players.some(
        (player) =>
          player.playerId === guestSession.playerId &&
          player.displayName === guestSession.displayName
      ))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "match must reference the active room and both players"
    });
  }
};

/**
 * Schema for the loose runtime snapshot used by validateHostAuthoritySnapshot.
 * room/hostSession/guestSession/match are all independently nullable; the
 * refinement below enforces their cross-field relationships.
 */
export const hostAuthoritySnapshotSchema = z
  .object({
    room: hostRoomRecordSchema.nullable(),
    hostSession: hostSessionRecordSchema.nullable(),
    guestSession: guestSessionRecordSchema.nullable(),
    chatMessages: z.array(chatMessageSchema),
    match: matchStateSchema.nullable()
  })
  .superRefine(checkHostAuthorityRelationships);

const guestRecoveryRecordBaseSchema = z.object({
  version: z.literal(P2P_RECOVERY_STORAGE_VERSION),
  role: z.literal("guest"),
  roomId: nonEmptyString,
  roomCode: nonEmptyString,
  playerId: nonEmptyString,
  displayName: nonEmptyString,
  sessionToken: nonEmptyString,
  players: z.array(playerIdentitySchema),
  reconnect: guestReconnectMetadataSchema
});

const hostRecoveryRecordBaseSchema = z.object({
  version: z.literal(P2P_RECOVERY_STORAGE_VERSION),
  role: z.literal("host"),
  room: hostRoomRecordSchema,
  hostSession: hostSessionRecordSchema,
  guestSession: guestSessionRecordSchema.nullable(),
  chatMessages: z.array(chatMessageSchema),
  match: matchStateSchema.nullable(),
  reconnect: hostReconnectMetadataSchema
});

export const guestRecoveryRecordSchema = guestRecoveryRecordBaseSchema;

export const hostRecoveryRecordSchema = hostRecoveryRecordBaseSchema.superRefine(
  checkHostAuthorityRelationships
);

// z.discriminatedUnion requires plain ZodObject members; the host variant's
// .superRefine produces a refined schema that can't be used as a discriminated
// union member. z.union works and the z.literal("role") guards still narrow it.
export const recoveryRecordSchema = z.union([
  guestRecoveryRecordBaseSchema,
  hostRecoveryRecordSchema
]);
