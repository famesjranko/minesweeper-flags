import type { MatchState, ResolvedAction } from "../match/match.types.js";

export interface SelectAction {
  type: "select";
  playerId: string;
  row: number;
  column: number;
}

export interface BombAction {
  type: "bomb";
  playerId: string;
  row: number;
  column: number;
}

export type MatchAction = SelectAction | BombAction;

export interface ActionFailure {
  ok: false;
  error: string;
}

export interface ActionSuccess {
  ok: true;
  state: MatchState;
  action: ResolvedAction;
}

export type ActionResolution = ActionFailure | ActionSuccess;

