import type { MatchStateDto } from "@minesweeper-flags/shared";
import type { SoloDifficulty } from "../bot/bot-profiles.js";

export const SOLO_HUMAN_ID = "solo-human";
export const SOLO_BOT_ID = "solo-bot";

export type SoloAction = { type: "select" | "bomb"; row: number; column: number };

export interface SoloSnapshot {
  match: MatchStateDto;
  humanId: string;
  difficulty: SoloDifficulty;
  bombArmed: boolean;
  botThinking: boolean;
  error: string | null;
  recoveryNotice: string | null;
}

export interface SoloScheduler {
  set: (callback: () => void) => unknown;
  clear: (handle: unknown) => void;
}

export interface SoloReplayAction extends SoloAction {
  playerId: string;
}

export interface SoloReplayRecord {
  version: 1;
  seed: number;
  createdAt: number;
  starter: "human" | "bot";
  difficulty: SoloDifficulty;
  actions: SoloReplayAction[];
  resignedBy?: "human" | "bot";
}
