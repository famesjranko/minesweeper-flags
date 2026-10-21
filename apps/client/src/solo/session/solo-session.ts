import {
  createMatchState,
  type MatchState,
  resignMatch,
  resolveAction
} from "@minesweeper-flags/game-engine";
import { toMatchStateDto } from "@minesweeper-flags/shared";
import { chooseSoloAction } from "../bot/solo-bot.js";
import { createBrowserSoloStorage, type SoloStorage } from "../storage/solo-storage.js";
import {
  SOLO_BOT_ID,
  SOLO_HUMAN_ID,
  type SoloAction,
  type SoloReplayRecord,
  type SoloScheduler,
  type SoloSnapshot
} from "./solo-session.types.js";

export type {
  SoloAction,
  SoloReplayRecord,
  SoloScheduler,
  SoloSnapshot
} from "./solo-session.types.js";

const defaultScheduler: SoloScheduler = {
  set: (callback) => setTimeout(callback, 0),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export interface SoloSessionOptions {
  scheduler?: SoloScheduler;
  storage?: SoloStorage;
  now?: () => number;
  nextSeed?: () => number;
  chooseAction?: (match: SoloSnapshot["match"], botPlayerId: string) => SoloAction | null;
}

export interface SoloSession {
  getSnapshot: () => SoloSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => void;
  submitCellAction: (row: number, column: number) => void;
  toggleBombMode: () => void;
  resign: () => void;
  restart: () => void;
  rematch: () => void;
  dispose: () => void;
}

const starterId = (starter: "human" | "bot"): string =>
  starter === "human" ? SOLO_HUMAN_ID : SOLO_BOT_ID;

const freshRecord = (
  seed: number,
  createdAt: number,
  starter: "human" | "bot"
): SoloReplayRecord => ({
  version: 1,
  seed,
  createdAt,
  starter,
  actions: []
});

const createState = (record: SoloReplayRecord): MatchState =>
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

const fallbackAction = (snapshot: SoloSnapshot["match"]): SoloAction | null => {
  for (const row of snapshot.board.cells) {
    const cell = row.find((candidate) => candidate.status === "hidden");
    if (cell) {
      return { type: "select", row: cell.row, column: cell.column };
    }
  }
  return null;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: lifecycle state is intentionally private to one authority.
export const createSoloSession = (options: SoloSessionOptions = {}): SoloSession => {
  const scheduler = options.scheduler ?? defaultScheduler;
  const storage = options.storage ?? createBrowserSoloStorage();
  const now = options.now ?? Date.now;
  const nextSeed = options.nextSeed ?? (() => Math.floor(Math.random() * 0x100000000));
  const chooseAction = options.chooseAction ?? chooseSoloAction;
  const listeners = new Set<() => void>();
  let state: MatchState | null = null;
  let record: SoloReplayRecord | null = null;
  let starter: "human" | "bot" = "human";
  let botTimer: unknown = null;
  let generation = 0;
  let started = false;
  let disposed = false;
  let bombArmed = false;
  let error: string | null = null;
  let recoveryNotice: string | null = null;
  let cachedSnapshot: SoloSnapshot | null = null;

  const snapshot = (): SoloSnapshot => {
    if (!state) {
      throw new Error("Solo session has not started.");
    }
    cachedSnapshot ??= {
      match: toMatchStateDto(state),
      humanId: SOLO_HUMAN_ID,
      bombArmed,
      botThinking:
        state.phase === "live" && state.currentTurnPlayerId === SOLO_BOT_ID && botTimer !== null,
      error,
      recoveryNotice
    };
    return cachedSnapshot;
  };

  const notify = (): void => {
    cachedSnapshot = null;
    listeners.forEach((listener) => {
      listener();
    });
  };

  const cancelBot = (): void => {
    generation += 1;
    if (botTimer !== null) {
      scheduler.clear(botTimer);
      botTimer = null;
    }
  };

  const persist = (): void => {
    if (!record) {
      return;
    }
    const notice = storage.write(record);
    if (notice) {
      recoveryNotice = notice;
    }
  };

  const applyAction = (playerId: string, action: SoloAction, replaying: boolean): boolean => {
    if (!state || !record) {
      return false;
    }
    const result = resolveAction(
      state,
      { ...action, playerId },
      record.createdAt + record.actions.length + 1
    );
    if (!result.ok) {
      if (!replaying) {
        error = result.error;
        notify();
      }
      return false;
    }
    if (result.action.revealedCount + result.action.claimedMineCount < 1) {
      return false;
    }
    state = result.state;
    record.actions.push({ ...action, playerId });
    return true;
  };

  const scheduleBot = (): void => {
    if (!state || disposed || state.phase !== "live" || state.currentTurnPlayerId !== SOLO_BOT_ID) {
      return;
    }
    const scheduledGeneration = generation;
    botTimer = scheduler.set(() => {
      botTimer = null;
      if (
        disposed ||
        scheduledGeneration !== generation ||
        !state ||
        state.phase !== "live" ||
        state.currentTurnPlayerId !== SOLO_BOT_ID
      ) {
        return;
      }
      const publicMatch = toMatchStateDto(state);
      let selected: SoloAction | null = null;
      try {
        selected = chooseAction(publicMatch, SOLO_BOT_ID);
      } catch {
        // A bot failure must not leave its turn permanently pending.
      }
      const action = selected ?? fallbackAction(publicMatch);
      if (!action || !applyAction(SOLO_BOT_ID, action, false)) {
        error = "The bot could not choose a legal move.";
        notify();
        return;
      }
      bombArmed = false;
      persist();
      scheduleBot();
      notify();
    });
  };

  const restore = (candidate: SoloReplayRecord): MatchState | null => {
    const restored = createState(candidate);
    state = restored;
    record = { ...candidate, actions: [] };
    for (const action of candidate.actions) {
      if (!applyAction(action.playerId, action, true)) {
        return null;
      }
    }
    if (candidate.resignedBy) {
      const playerId = starterId(candidate.resignedBy);
      if (state.phase !== "live" || !state.players.some((player) => player.playerId === playerId)) {
        return null;
      }
      state = resignMatch(state, playerId, record.createdAt + record.actions.length + 1);
      record.resignedBy = candidate.resignedBy;
    }
    return state;
  };

  const beginFresh = (nextStarter: "human" | "bot", notice: string | null): void => {
    cancelBot();
    starter = nextStarter;
    record = freshRecord(nextSeed() >>> 0, now(), starter);
    state = createState(record);
    bombArmed = false;
    error = null;
    recoveryNotice = notice;
    persist();
    scheduleBot();
    notify();
  };

  return {
    getSnapshot: snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      if (started || disposed) {
        return;
      }
      started = true;
      const recovered = storage.read();
      if (recovered.record && restore(recovered.record)) {
        starter = recovered.record.starter;
        recoveryNotice = recovered.notice;
        scheduleBot();
        notify();
        return;
      }
      if (recovered.record) {
        storage.clear();
      }
      beginFresh(
        "human",
        recovered.notice ??
          (recovered.record ? "Saved solo progress was invalid and was reset." : null)
      );
    },
    submitCellAction: (row, column) => {
      if (
        !state ||
        disposed ||
        state.phase !== "live" ||
        state.currentTurnPlayerId !== SOLO_HUMAN_ID
      ) {
        return;
      }
      error = null;
      const action: SoloAction = { type: bombArmed ? "bomb" : "select", row, column };
      if (!applyAction(SOLO_HUMAN_ID, action, false)) {
        return;
      }
      bombArmed = false;
      persist();
      scheduleBot();
      notify();
    },
    toggleBombMode: () => {
      if (
        !state ||
        disposed ||
        state.phase !== "live" ||
        state.currentTurnPlayerId !== SOLO_HUMAN_ID
      ) {
        return;
      }
      const human = state.players.find((player) => player.playerId === SOLO_HUMAN_ID);
      const bot = state.players.find((player) => player.playerId === SOLO_BOT_ID);
      if (!human || !bot || human.bombsRemaining === 0 || bot.score - human.score < 4) {
        return;
      }
      bombArmed = !bombArmed;
      error = null;
      notify();
    },
    resign: () => {
      if (!state || !record || disposed || state.phase !== "live") {
        return;
      }
      cancelBot();
      state = resignMatch(state, SOLO_HUMAN_ID, record.createdAt + record.actions.length + 1);
      record.resignedBy = "human";
      bombArmed = false;
      persist();
      notify();
    },
    restart: () => {
      if (!disposed) {
        beginFresh("human", null);
      }
    },
    rematch: () => {
      if (!disposed) {
        beginFresh(starter === "human" ? "bot" : "human", null);
      }
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelBot();
      listeners.clear();
    }
  };
};
