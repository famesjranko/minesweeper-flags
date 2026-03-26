import type { MatchState } from "./match.types.js";

export const incrementPlayerScore = (
  state: MatchState,
  playerId: string,
  amount: number
): MatchState => ({
  ...state,
  players: state.players.map((player) =>
    player.playerId === playerId
      ? {
          ...player,
          score: player.score + amount
        }
      : player
  ) as MatchState["players"]
});

export const useBomb = (state: MatchState, playerId: string): MatchState => ({
  ...state,
  players: state.players.map((player) =>
    player.playerId === playerId
      ? {
          ...player,
          bombsRemaining: 0
        }
      : player
  ) as MatchState["players"]
});

export const clearRematchVotes = (state: MatchState): MatchState => ({
  ...state,
  players: state.players.map((player) => ({
    ...player,
    rematchRequested: false
  })) as MatchState["players"]
});

export const setPlayerConnection = (
  state: MatchState,
  playerId: string,
  connected: boolean
): MatchState => ({
  ...state,
  players: state.players.map((player) =>
    player.playerId === playerId
      ? {
          ...player,
          connected
        }
      : player
  ) as MatchState["players"]
});

export const setPlayerRematchRequested = (
  state: MatchState,
  playerId: string,
  rematchRequested: boolean
): MatchState => ({
  ...state,
  players: state.players.map((player) =>
    player.playerId === playerId
      ? {
          ...player,
          rematchRequested
        }
      : player
  ) as MatchState["players"]
});

export const isPlayerTrailing = (state: MatchState, playerId: string): boolean => {
  const player = state.players.find((entry) => entry.playerId === playerId);
  const opponent = state.players.find((entry) => entry.playerId !== playerId);

  if (!player || !opponent) {
    throw new Error(`Unknown player ${playerId}.`);
  }

  return player.score < opponent.score;
};

