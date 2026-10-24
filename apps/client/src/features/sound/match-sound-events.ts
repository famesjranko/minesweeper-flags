import { WINNING_SCORE } from "@minesweeper-flags/game-engine";
import type { MatchStateDto } from "@minesweeper-flags/shared";
import { isSameAction } from "../../entities/board/last-move.js";
import type { SoundName } from "./sound-player.js";

type Outcome = NonNullable<MatchStateDto["lastAction"]>["outcome"];

const MOVE_SOUNDS: Record<Outcome, SoundName> = {
  safe_reveal: "reveal",
  mine_claimed: "flag",
  bomb_used: "bomb"
};

const moveSound = (previous: MatchStateDto, next: MatchStateDto): SoundName | null => {
  const { lastAction } = next;
  if (lastAction === null) {
    return null;
  }
  const isNewAction =
    previous.turnNumber !== next.turnNumber ||
    previous.lastAction === null ||
    !isSameAction(previous.lastAction, lastAction);
  return isNewAction ? MOVE_SOUNDS[lastAction.outcome] : null;
};

// The engine ends a match without a WINNING_SCORE only through resign, so the snapshot alone tells who gave up.
const finishSound = (next: MatchStateDto, viewerPlayerId: string): SoundName => {
  if (next.winnerPlayerId === viewerPlayerId) {
    return "win";
  }
  const someoneWon = next.players.some((player) => player.score >= WINNING_SCORE);
  return someoneWon ? "lose" : "resign";
};

/** Turns two consecutive snapshots into the sounds the viewer should hear. */
export const diffMatchSounds = (
  previous: MatchStateDto | null,
  next: MatchStateDto,
  viewerPlayerId: string
): SoundName[] => {
  if (previous === null) {
    return [];
  }
  const sounds: SoundName[] = [];
  const move = moveSound(previous, next);
  if (move) {
    sounds.push(move);
  }

  if (next.phase === "finished") {
    if (previous.phase !== "finished") {
      sounds.push(finishSound(next, viewerPlayerId));
    }
  } else if (
    next.phase === "live" &&
    next.currentTurnPlayerId === viewerPlayerId &&
    previous.currentTurnPlayerId !== viewerPlayerId
  ) {
    sounds.push("your-turn");
  }
  return sounds;
};
