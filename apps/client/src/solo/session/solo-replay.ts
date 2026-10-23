import {
  createMatchState,
  type MatchState,
  resignMatch,
  resolveAction
} from "@minesweeper-flags/game-engine";
import { SOLO_BOT_ID, SOLO_HUMAN_ID, type SoloReplayRecord } from "./solo-session.types.js";

const starterId = (starter: "human" | "bot"): string =>
  starter === "human" ? SOLO_HUMAN_ID : SOLO_BOT_ID;

export const createSoloState = (record: SoloReplayRecord): MatchState =>
  createMatchState({
    roomId: "solo-local",
    players: [
      { playerId: SOLO_HUMAN_ID, displayName: "You" },
      { playerId: SOLO_BOT_ID, displayName: "Bot" }
    ],
    seed: record.seed,
    createdAt: record.createdAt,
    startingPlayerId: starterId(record.starter)
  });

// The lobby and session use the same engine replay, without starting bot work or persistence.
export const replaySoloRecord = (record: SoloReplayRecord): MatchState | null => {
  let state = createSoloState(record);
  for (const [index, action] of record.actions.entries()) {
    const result = resolveAction(state, action, record.createdAt + index + 1);
    if (!result.ok || result.action.revealedCount + result.action.claimedMineCount < 1) {
      return null;
    }
    state = result.state;
  }
  if (record.resignedBy) {
    if (state.phase !== "live") return null;
    state = resignMatch(
      state,
      starterId(record.resignedBy),
      record.createdAt + record.actions.length + 1
    );
  }
  return state;
};
