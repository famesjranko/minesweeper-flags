import { z } from "zod";
import {
  type BoardCellDto,
  boardStateDtoSchema,
  type MatchStateDto,
  matchStateDtoSchema
} from "./match.schema.js";

/*
 * On the wire a match sends its board as one character per cell, row by row, instead of one object
 * per cell. A giant board is then about 1 KB, not about 96 KB. Direct play needs this: a peer that
 * advertises no data channel message size falls back to 64 KB, and a larger message fails.
 */
const HIDDEN = "-";
const MINE_REVEALED = "*";
// Claimed cells name the claimant by their index in `players`.
const CLAIMANTS = ["A", "B"] as const;

const wireMatchSchema = matchStateDtoSchema.extend({
  board: boardStateDtoSchema.extend({ cells: z.string().regex(/^[-*0-8AB]*$/) })
});

type WireMatch = z.infer<typeof wireMatchSchema>;

const encodeCell = (cell: BoardCellDto, playerIds: readonly string[]): string => {
  switch (cell.status) {
    case "hidden":
      return HIDDEN;
    case "mine-revealed":
      return MINE_REVEALED;
    case "revealed":
      if (cell.adjacentMines === null) {
        throw new Error(`Revealed cell ${cell.row},${cell.column} has no adjacent mine count.`);
      }
      return String(cell.adjacentMines);
    case "claimed": {
      const claimant = CLAIMANTS[playerIds.indexOf(cell.claimedByPlayerId ?? "")];
      if (!claimant) {
        throw new Error(`Claimed cell ${cell.row},${cell.column} names no player of this match.`);
      }
      return claimant;
    }
  }
};

const decodeCell = (
  code: string,
  row: number,
  column: number,
  playerIds: readonly string[]
): BoardCellDto => {
  const cell = { row, column, adjacentMines: null, claimedByPlayerId: null };
  if (code === HIDDEN) return { ...cell, status: "hidden" };
  if (code === MINE_REVEALED) return { ...cell, status: "mine-revealed" };
  const claimantIndex = CLAIMANTS.indexOf(code as (typeof CLAIMANTS)[number]);
  if (claimantIndex >= 0) {
    return { ...cell, status: "claimed", claimedByPlayerId: playerIds[claimantIndex] ?? null };
  }
  return { ...cell, status: "revealed", adjacentMines: Number(code) };
};

const encodeMatch = (match: MatchStateDto): WireMatch => {
  const { rows, columns, cells } = match.board;
  if (cells.length !== rows || cells.some((cellRow) => cellRow.length !== columns)) {
    throw new Error(`Board cells do not match its ${rows}x${columns} shape.`);
  }
  const playerIds = match.players.map((player) => player.playerId);
  const encoded = cells.flat().map((cell) => encodeCell(cell, playerIds));
  return { ...match, board: { ...match.board, cells: encoded.join("") } };
};

const decodeMatch = (wire: WireMatch, ctx: z.core.ParsePayload<WireMatch>): MatchStateDto => {
  const { rows, columns, cells } = wire.board;
  if (cells.length !== rows * columns) {
    ctx.issues.push({
      code: "custom",
      message: `Board has ${cells.length} cells, not ${rows * columns}.`,
      input: wire.board.cells,
      path: ["board", "cells"]
    });
    return z.NEVER;
  }
  const playerIds = wire.players.map((player) => player.playerId);
  const decoded = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) =>
      decodeCell(cells[row * columns + column] ?? HIDDEN, row, column, playerIds)
    )
  );
  return { ...wire, board: { ...wire.board, cells: decoded } };
};

/** Parse decodes a received match; `encode` produces the form to send. */
export const matchStateWireSchema = z.codec(wireMatchSchema, matchStateDtoSchema, {
  decode: decodeMatch,
  encode: encodeMatch
});
