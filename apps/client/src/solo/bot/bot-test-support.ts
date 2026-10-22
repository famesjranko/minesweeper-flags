import type { MatchStateDto } from "@minesweeper-flags/shared";

// Builders shared by the bot tests. Nothing in the app imports this module.

export const BOT_ID = "bot";
export const HUMAN_ID = "human";

export const createMatch = (overrides: Partial<MatchStateDto> = {}): MatchStateDto => ({
  roomId: "solo",
  phase: "live",
  board: {
    rows: 16,
    columns: 16,
    mineCount: 51,
    cells: Array.from({ length: 16 }, (_, row) =>
      Array.from({ length: 16 }, (_, column) => ({
        row,
        column,
        status: "hidden" as const,
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  },
  players: [
    {
      playerId: BOT_ID,
      displayName: "Bot",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: HUMAN_ID,
      displayName: "Human",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: BOT_ID,
  turnPhase: "awaiting_action",
  turnNumber: 1,
  winnerPlayerId: null,
  lastAction: null,
  ...overrides
});

export const createSizedMatch = (
  rows: number,
  columns: number,
  mineCount: number
): MatchStateDto => {
  const match = createMatch();
  match.board = {
    rows,
    columns,
    mineCount,
    cells: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => ({
        row,
        column,
        status: "hidden" as const,
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  };
  return match;
};

export const reveal = (
  match: MatchStateDto,
  row: number,
  column: number,
  adjacentMines: number
): void => {
  match.board.cells[row]![column] = {
    row,
    column,
    status: "revealed",
    adjacentMines,
    claimedByPlayerId: null
  };
};

export const claim = (match: MatchStateDto, row: number, column: number): void => {
  match.board.cells[row]![column] = {
    row,
    column,
    status: "claimed",
    adjacentMines: null,
    claimedByPlayerId: HUMAN_ID
  };
};

/** Mulberry32: a small, well-mixed generator so tests can replay exact bot choices. */
export const createSeededRandom = (seed: number): (() => number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const seeds = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);
