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

interface HostAuthorityRule {
  message: string;
  isBroken: (value: HostAuthorityRefinementInput) => boolean;
}

type PlayerIdentity = { playerId: string; displayName: string };

const containsIdentity = (players: readonly PlayerIdentity[], identity: PlayerIdentity): boolean =>
  players.some(
    (player) => player.playerId === identity.playerId && player.displayName === identity.displayName
  );

/**
 * Cross-field rules that apply to any host-authority shape (both the stored
 * recovery record and the looser runtime snapshot passed to
 * validateHostAuthoritySnapshot). Keeping the rules in one list means the two
 * consumers can't drift. Order matters: only the first broken rule is reported.
 */
const HOST_AUTHORITY_RULES: readonly HostAuthorityRule[] = [
  {
    message: "room and hostSession must both be present or both null",
    isBroken: ({ room, hostSession }) => (room === null) !== (hostSession === null)
  },
  {
    message: "guestSession requires a room",
    isBroken: ({ room, guestSession }) => guestSession !== null && room === null
  },
  {
    message: "match requires room, hostSession, and guestSession",
    isBroken: ({ room, hostSession, guestSession, match }) =>
      match !== null && (room === null || hostSession === null || guestSession === null)
  },
  {
    message: "hostSession must match room roomId/roomCode",
    isBroken: ({ room, hostSession }) =>
      room !== null &&
      hostSession !== null &&
      (hostSession.roomId !== room.roomId || hostSession.roomCode !== room.roomCode)
  },
  {
    message: "guestSession must match room roomId/roomCode",
    isBroken: ({ room, guestSession }) =>
      room !== null &&
      guestSession !== null &&
      (guestSession.roomId !== room.roomId || guestSession.roomCode !== room.roomCode)
  },
  {
    message: "room.players must contain hostSession identity",
    isBroken: ({ room, hostSession }) =>
      room !== null && hostSession !== null && !containsIdentity(room.players, hostSession)
  },
  {
    message: "room without guestSession must contain exactly one player",
    isBroken: ({ room, hostSession, guestSession }) =>
      room !== null && hostSession !== null && guestSession === null && room.players.length !== 1
  },
  {
    message: "room.players must contain guestSession identity",
    isBroken: ({ room, guestSession }) =>
      room !== null && guestSession !== null && !containsIdentity(room.players, guestSession)
  },
  {
    message: "hostSession and guestSession must have distinct playerId and sessionToken",
    isBroken: ({ hostSession, guestSession }) =>
      hostSession !== null &&
      guestSession !== null &&
      (hostSession.playerId === guestSession.playerId ||
        hostSession.sessionToken === guestSession.sessionToken)
  },
  {
    message: "full room must contain exactly two uniquely identified players",
    isBroken: ({ room, hostSession, guestSession }) =>
      room !== null &&
      hostSession !== null &&
      guestSession !== null &&
      (room.players.length !== 2 ||
        new Set(room.players.map((player) => player.playerId)).size !== room.players.length)
  },
  {
    message: "match must reference the active room and both players",
    isBroken: ({ room, hostSession, guestSession, match }) =>
      match !== null &&
      room !== null &&
      hostSession !== null &&
      guestSession !== null &&
      (match.roomId !== room.roomId ||
        match.players[0].playerId === match.players[1].playerId ||
        !containsIdentity(match.players, hostSession) ||
        !containsIdentity(match.players, guestSession))
  }
];

const checkHostAuthorityRelationships = (
  value: HostAuthorityRefinementInput,
  ctx: z.RefinementCtx
): void => {
  const brokenRule = HOST_AUTHORITY_RULES.find((rule) => rule.isBroken(value));

  if (brokenRule) {
    ctx.addIssue({ code: "custom", message: brokenRule.message });
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
