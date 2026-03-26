import type { MatchAction, MatchState } from "@minesweeper-flags/game-engine";
import type { MatchStateDto } from "@minesweeper-flags/shared";

export interface MatchResult {
  roomCode: string;
  state: MatchState;
  dto: MatchStateDto;
}

export interface ActionResult extends MatchResult {
  action: MatchAction;
}

