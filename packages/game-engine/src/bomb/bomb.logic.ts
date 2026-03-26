import { getBombCoordinates } from "../board/board.logic.js";
import type { MatchState } from "../match/match.types.js";

export const getBombArea = (state: MatchState, row: number, column: number) =>
  getBombCoordinates(state.board, row, column);

