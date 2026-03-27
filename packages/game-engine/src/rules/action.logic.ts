import { createBoard, getCell, revealBombArea, revealConnectedSafeCells } from "../board/board.logic.js";
import {
  MIN_BOMB_DEFICIT,
  clearRematchVotes,
  incrementPlayerScore,
  isPlayerTrailingByAtLeast,
  useBomb
} from "../match/scoring.logic.js";
import type { MatchState, PlayerMatchState } from "../match/match.types.js";
import { keepTurn, switchTurn } from "../match/turn.logic.js";
import { findWinnerPlayerId, isFinished } from "../match/win.logic.js";
import type { ActionResolution, MatchAction } from "./action.types.js";

interface CreateMatchOptions {
  roomId: string;
  players: [Pick<PlayerMatchState, "playerId" | "displayName">, Pick<PlayerMatchState, "playerId" | "displayName">];
  seed: number;
  createdAt: number;
  startingPlayerId: string;
}

const finalizeState = (state: MatchState, updatedAt: number): MatchState => {
  const winnerPlayerId = findWinnerPlayerId(state);

  if (!isFinished(state)) {
    return {
      ...state,
      phase: "live",
      turnPhase: "awaiting_action",
      winnerPlayerId,
      updatedAt
    };
  }

  return {
    ...state,
    phase: "finished",
    turnPhase: "ended",
    winnerPlayerId,
    currentTurnPlayerId: null,
    updatedAt
  };
};

const reject = (error: string): ActionResolution => ({
  ok: false,
  error
});

export const createMatchState = ({
  roomId,
  players,
  seed,
  createdAt,
  startingPlayerId
}: CreateMatchOptions): MatchState => ({
  roomId,
  phase: "live",
  board: createBoard(seed),
  players: players.map((player) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    score: 0,
    bombsRemaining: 1,
    connected: true,
    rematchRequested: false
  })) as MatchState["players"],
  currentTurnPlayerId: startingPlayerId,
  turnPhase: "awaiting_action",
  turnNumber: 1,
  winnerPlayerId: null,
  lastAction: null,
  seed,
  createdAt,
  updatedAt: createdAt
});

export const resolveAction = (
  state: MatchState,
  action: MatchAction,
  updatedAt: number
): ActionResolution => {
  if (state.phase !== "live") {
    return reject("The match is not currently active.");
  }

  if (state.currentTurnPlayerId !== action.playerId) {
    return reject("It is not your turn.");
  }

  const actingPlayer = state.players.find((player) => player.playerId === action.playerId);

  if (!actingPlayer) {
    return reject("The player is not part of this match.");
  }

  const cell = getCell(state.board, action.row, action.column);

  if (cell.claimedByPlayerId || cell.isRevealed) {
    return reject("That cell has already been resolved.");
  }

  if (action.type === "select") {
    if (cell.hasMine) {
      const nextBoard = {
        ...state.board,
        cells: state.board.cells.map((row) => row.map((entry) => ({ ...entry })))
      };
      nextBoard.cells[action.row]![action.column]!.claimedByPlayerId = action.playerId;

      const scoredState = incrementPlayerScore(
        {
          ...state,
          board: nextBoard
        },
        action.playerId,
        1
      );

      const actionResult = {
        type: "select" as const,
        playerId: action.playerId,
        row: action.row,
        column: action.column,
        outcome: "mine_claimed" as const,
        revealedCount: 0,
        claimedMineCount: 1
      };

      const nextState = finalizeState(
        {
          ...clearRematchVotes(keepTurn(scoredState)),
          lastAction: actionResult
        },
        updatedAt
      );

      return { ok: true, state: nextState, action: actionResult };
    }

    const revealed = revealConnectedSafeCells(state.board, action.row, action.column);
    const actionResult = {
      type: "select" as const,
      playerId: action.playerId,
      row: action.row,
      column: action.column,
      outcome: "safe_reveal" as const,
      revealedCount: revealed.revealedCount,
      claimedMineCount: 0
    };

    const nextState = finalizeState(
      {
        ...clearRematchVotes(
          switchTurn(
            {
              ...state,
              board: revealed.board
            },
            action.playerId
          )
        ),
        lastAction: actionResult
      },
      updatedAt
    );

    return { ok: true, state: nextState, action: actionResult };
  }

  if (actingPlayer.bombsRemaining === 0) {
    return reject("You have already used your bomb.");
  }

  if (!isPlayerTrailingByAtLeast(state, action.playerId)) {
    return reject(`Bombs can only be used while trailing by ${MIN_BOMB_DEFICIT} or more.`);
  }

  const bombResult = revealBombArea(state.board, action.row, action.column);
  const nextBoard = {
    ...bombResult.board,
    cells: bombResult.board.cells.map((row) => row.map((entry) => ({ ...entry })))
  };

  for (const coordinate of bombResult.claimedMineCoordinates) {
    nextBoard.cells[coordinate.row]![coordinate.column]!.claimedByPlayerId = action.playerId;
  }

  const scoredState = incrementPlayerScore(
    useBomb(
      {
        ...state,
        board: nextBoard
      },
      action.playerId
    ),
    action.playerId,
    bombResult.claimedMineCoordinates.length
  );

  const actionResult = {
    type: "bomb" as const,
    playerId: action.playerId,
    row: action.row,
    column: action.column,
    outcome: "bomb_used" as const,
    revealedCount: bombResult.revealedCount,
    claimedMineCount: bombResult.claimedMineCoordinates.length,
    claimedMineCoordinates: bombResult.claimedMineCoordinates
  };

  const nextState = finalizeState(
    {
      ...clearRematchVotes(switchTurn(scoredState, action.playerId)),
      lastAction: actionResult
    },
    updatedAt
  );

  return { ok: true, state: nextState, action: actionResult };
};
