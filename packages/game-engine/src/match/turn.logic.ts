import type { MatchState } from "./match.types.js";

export const getPlayerIndex = (state: MatchState, playerId: string): 0 | 1 | -1 => {
  const playerIndex = state.players.findIndex((player) => player.playerId === playerId);
  return playerIndex === 0 || playerIndex === 1 ? playerIndex : -1;
};

export const getOpponentPlayerId = (state: MatchState, playerId: string): string => {
  const playerIndex = getPlayerIndex(state, playerId);

  if (playerIndex === -1) {
    throw new Error(`Unknown player ${playerId}.`);
  }

  return state.players[playerIndex === 0 ? 1 : 0].playerId;
};

export const switchTurn = (state: MatchState, playerId: string): MatchState => ({
  ...state,
  currentTurnPlayerId: getOpponentPlayerId(state, playerId),
  turnNumber: state.turnNumber + 1
});

export const keepTurn = (state: MatchState): MatchState => ({
  ...state,
  turnNumber: state.turnNumber + 1
});

