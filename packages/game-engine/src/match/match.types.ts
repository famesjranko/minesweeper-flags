import type { BoardState, Coordinate } from "../board/board.types.js";

export type MatchPhase = "waiting" | "live" | "finished";
export type TurnPhase = "awaiting_action" | "ended";

export interface PlayerMatchState {
  playerId: string;
  displayName: string;
  score: number;
  bombsRemaining: 0 | 1;
  connected: boolean;
  rematchRequested: boolean;
}

export interface ResolvedAction {
  type: "select" | "bomb";
  playerId: string;
  row: number;
  column: number;
  outcome: "mine_claimed" | "safe_reveal" | "bomb_used";
  revealedCount: number;
  claimedMineCount: number;
  claimedMineCoordinates?: Coordinate[];
}

export interface MatchState {
  roomId: string;
  phase: MatchPhase;
  board: BoardState;
  players: [PlayerMatchState, PlayerMatchState];
  currentTurnPlayerId: string | null;
  turnPhase: TurnPhase;
  turnNumber: number;
  winnerPlayerId: string | null;
  lastAction: ResolvedAction | null;
  seed: number;
  createdAt: number;
  updatedAt: number;
}

