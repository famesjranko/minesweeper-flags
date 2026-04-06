import type { MatchState } from "@minesweeper-flags/game-engine";
import type { MatchStateDto } from "../protocol/dto.js";

export const toMatchStateDto = (matchState: MatchState): MatchStateDto => ({
  roomId: matchState.roomId,
  phase: matchState.phase,
  board: {
    rows: matchState.board.rows,
    columns: matchState.board.columns,
    mineCount: matchState.board.mineCount,
    cells: matchState.board.cells.map((row) =>
      row.map((cell) => {
        if (cell.claimedByPlayerId) {
          return {
            row: cell.row,
            column: cell.column,
            status: "claimed" as const,
            adjacentMines: null,
            claimedByPlayerId: cell.claimedByPlayerId
          };
        }

        if (cell.isRevealed) {
          return {
            row: cell.row,
            column: cell.column,
            status: "revealed" as const,
            adjacentMines: cell.adjacentMines,
            claimedByPlayerId: null
          };
        }

        if (matchState.phase === "finished" && cell.hasMine) {
          return {
            row: cell.row,
            column: cell.column,
            status: "mine-revealed" as const,
            adjacentMines: null,
            claimedByPlayerId: null
          };
        }

        return {
          row: cell.row,
          column: cell.column,
          status: "hidden" as const,
          adjacentMines: null,
          claimedByPlayerId: null
        };
      })
    )
  },
  players: [{ ...matchState.players[0] }, { ...matchState.players[1] }],
  currentTurnPlayerId: matchState.currentTurnPlayerId,
  turnPhase: matchState.turnPhase,
  turnNumber: matchState.turnNumber,
  winnerPlayerId: matchState.winnerPlayerId,
  lastAction: matchState.lastAction
    ? {
        ...matchState.lastAction,
        claimedMineCoordinates: matchState.lastAction.claimedMineCoordinates
      }
    : null
});
