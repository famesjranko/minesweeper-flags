import { createMatchState, type MatchState } from "@minesweeper-flags/game-engine";
import { describe, expect, it } from "vitest";
import { toMatchStateDto } from "../adapters/to-match-state-dto.js";
import { matchStateWireSchema } from "./match-wire.schema.js";

// The smallest data channel message size a direct-play peer can fall back to.
const DATA_CHANNEL_FALLBACK_BYTES = 64 * 1024;

const createGiantMatch = (): MatchState =>
  createMatchState({
    roomId: "room-1",
    players: [
      { playerId: "player-1", displayName: "Host" },
      { playerId: "player-2", displayName: "Guest" }
    ],
    seed: 7,
    createdAt: 0,
    startingPlayerId: "player-1",
    boardSize: "giant"
  });

// A finished board with every kind of cell: claimed by each player, revealed, and unclaimed mines.
const createFinishedGiantMatch = (): MatchState => {
  const match = createGiantMatch();
  const cells = match.board.cells.flat();
  const mines = cells.filter((cell) => cell.hasMine);
  for (const [index, cell] of mines.slice(0, 40).entries()) {
    cell.claimedByPlayerId = index % 2 === 0 ? "player-1" : "player-2";
    cell.isRevealed = true;
  }
  for (const cell of cells.filter((candidate) => !candidate.hasMine).slice(0, 300)) {
    cell.isRevealed = true;
  }
  return { ...match, phase: "finished", winnerPlayerId: "player-1" };
};

const encodeToJson = (match: MatchState): string =>
  JSON.stringify(matchStateWireSchema.encode(toMatchStateDto(match)));

describe("match wire codec", () => {
  it("decodes an encoded board back to the same match", () => {
    // Given a finished giant match with claimed, revealed, hidden and unclaimed mine cells
    const dto = toMatchStateDto(createFinishedGiantMatch());

    // When the match is encoded, sent as JSON and parsed on the other side
    const received = matchStateWireSchema.parse(
      JSON.parse(JSON.stringify(matchStateWireSchema.encode(dto)))
    );

    // Then the received match equals the sent match, cell for cell
    expect(received).toEqual(dto);
    // And the board covers every cell status
    expect(new Set(received.board.cells.flat().map((cell) => cell.status))).toEqual(
      new Set(["hidden", "revealed", "claimed", "mine-revealed"])
    );
  });

  it("fits a giant match in one direct-play message", () => {
    // Given a finished giant match
    const match = createFinishedGiantMatch();

    // When the match is encoded as JSON
    const json = encodeToJson(match);

    // Then it is far below the data channel fallback size
    expect(json.length).toBeLessThan(DATA_CHANNEL_FALLBACK_BYTES / 16);
  });

  it("rejects a board with fewer cells than its shape", () => {
    // Given an encoded giant match with one cell missing
    const wire = matchStateWireSchema.encode(toMatchStateDto(createGiantMatch()));
    const truncated = { ...wire, board: { ...wire.board, cells: wire.board.cells.slice(1) } };

    // When the match is parsed
    const result = matchStateWireSchema.safeParse(truncated);

    // Then it is rejected
    expect(result.success).toBe(false);
  });

  it("rejects a board larger than the largest preset", () => {
    // Given an encoded match that claims a 31×31 board with a matching cell string
    const wire = matchStateWireSchema.encode(toMatchStateDto(createGiantMatch()));
    const oversized = {
      ...wire,
      board: { ...wire.board, rows: 31, columns: 31, cells: "-".repeat(31 * 31) }
    };

    // When the match is parsed
    const result = matchStateWireSchema.safeParse(oversized);

    // Then it is rejected
    expect(result.success).toBe(false);
  });

  it("rejects a board with an unknown cell code", () => {
    // Given an encoded giant match whose first cell has a code no status uses
    const wire = matchStateWireSchema.encode(toMatchStateDto(createGiantMatch()));
    const corrupted = { ...wire, board: { ...wire.board, cells: `9${wire.board.cells.slice(1)}` } };

    // When the match is parsed
    const result = matchStateWireSchema.safeParse(corrupted);

    // Then it is rejected
    expect(result.success).toBe(false);
  });
});
