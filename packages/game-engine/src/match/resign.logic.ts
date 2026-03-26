import { clearRematchVotes } from "./scoring.logic.js";
import type { MatchState } from "./match.types.js";
import { getOpponentPlayerId, getPlayerIndex } from "./turn.logic.js";

export const resignMatch = (state: MatchState, playerId: string, updatedAt: number): MatchState => {
  if (state.phase !== "live") {
    throw new Error("The match is not currently active.");
  }

  if (getPlayerIndex(state, playerId) === -1) {
    throw new Error("The player is not part of this match.");
  }

  return clearRematchVotes({
    ...state,
    phase: "finished",
    turnPhase: "ended",
    currentTurnPlayerId: null,
    winnerPlayerId: getOpponentPlayerId(state, playerId),
    updatedAt
  });
};
