import type { MatchStateDto } from "@minesweeper-flags/shared";

export const SOLO_HUMAN_ID = "solo-human";
export const SOLO_BOT_ID = "solo-bot";

export type SoloAction = { type: "select" | "bomb"; row: number; column: number };

export interface SoloSnapshot {
  match: MatchStateDto;
  humanId: string;
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
  actions: SoloReplayAction[];
  resignedBy?: "human" | "bot";
}
