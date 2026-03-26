import { WINNING_SCORE } from "../board/board.constants.js";
import { countClaimedMines } from "../board/board.logic.js";
import type { MatchState } from "./match.types.js";

export const findWinnerPlayerId = (state: MatchState): string | null => {
  const instantWinner = state.players.find((player) => player.score >= WINNING_SCORE);

  if (instantWinner) {
    return instantWinner.playerId;
  }

  if (countClaimedMines(state.board) < state.board.mineCount) {
    return null;
  }

  if (state.players[0].score === state.players[1].score) {
    return null;
  }

  return state.players[0].score > state.players[1].score
    ? state.players[0].playerId
    : state.players[1].playerId;
};

export const isFinished = (state: MatchState): boolean =>
  state.players.some((player) => player.score >= WINNING_SCORE) ||
  countClaimedMines(state.board) === state.board.mineCount;

export { WINNING_SCORE };

