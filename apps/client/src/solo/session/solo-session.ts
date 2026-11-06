import {
  BOARD_SIZES,
  type BoardSize,
  DEFAULT_BOARD_SIZE,
  getBombDeficit,
  type MatchState,
  resignMatch,
  resolveAction
} from "@minesweeper-flags/game-engine";
import { toMatchStateDto } from "@minesweeper-flags/shared";
import { DEFAULT_SOLO_DIFFICULTY, type SoloDifficulty } from "../bot/bot-profiles.js";
import { chooseSoloAction } from "../bot/solo-bot.js";
import { SOLO_DIFFICULTY_COPY } from "../solo-difficulty-options.js";
import { createBrowserSoloStorage, type SoloStorage } from "../storage/solo-storage.js";
import { createSoloState, replaySoloRecord } from "./solo-replay.js";
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
  set: (callback) => setTimeout(callback, 500),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export interface SoloSessionOptions {
  /** Explicit lobby Start new intent; ordinary entry restores live progress. */
  startFresh?: boolean;
  /** A reload should show the same page, so a finished match stays until the player leaves it. */
  keepFinished?: boolean;
  scheduler?: SoloScheduler;
  storage?: SoloStorage;
  now?: () => number;
  nextSeed?: () => number;
  /**
   * The player's current level choice, read whenever a fresh match begins (including
   * Play again). A resumed live match keeps the level it was saved with.
   */
  preferredDifficulty?: () => SoloDifficulty;
  /** The player's board size choice, read at the same moments as the level. */
  preferredBoardSize?: () => BoardSize;
  chooseAction?: (
    match: SoloSnapshot["match"],
    botPlayerId: string,
    difficulty: SoloDifficulty
  ) => SoloAction | null;
  /** Uniform numbers in [0, 1) for the default bot's choices. */
  random?: () => number;
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

interface SoloSetup {
  difficulty: SoloDifficulty;
  boardSize: BoardSize;
}

// Names only the settings that differ, so a level-only change reads "Normal", not "Normal 16×16".
const describeSetup = (setup: SoloSetup, differs: Record<keyof SoloSetup, boolean>): string => {
  const { rows, columns } = BOARD_SIZES[setup.boardSize];
  return [
    differs.difficulty ? SOLO_DIFFICULTY_COPY[setup.difficulty].label : null,
    differs.boardSize ? `${rows}×${columns}` : null
  ]
    .filter(Boolean)
    .join(" ");
};

// A resumed live match keeps its setup; say so when the player has since picked another.
const setupNotice = (
  state: MatchState | null,
  saved: SoloSetup,
  preferred: SoloSetup
): string | null => {
  const differs = {
    difficulty: saved.difficulty !== preferred.difficulty,
    boardSize: saved.boardSize !== preferred.boardSize
  };
  if (state?.phase !== "live" || (!differs.difficulty && !differs.boardSize)) {
    return null;
  }
  return `Resumed your ${describeSetup(saved, differs)} match. ${describeSetup(preferred, differs)} starts with your next match.`;
};

const freshRecord = (
  seed: number,
  createdAt: number,
  starter: "human" | "bot",
  setup: SoloSetup
): SoloReplayRecord => ({
  version: 1,
  seed,
  createdAt,
  starter,
  ...setup,
  actions: []
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
  const random = options.random ?? Math.random;
  const chooseAction =
    options.chooseAction ??
    ((match: SoloSnapshot["match"], botPlayerId: string, difficulty: SoloDifficulty) =>
      chooseSoloAction(match, botPlayerId, { difficulty, random }));
  const listeners = new Set<() => void>();
  let state: MatchState | null = null;
  let record: SoloReplayRecord | null = null;
  let starter: "human" | "bot" = "human";
  const preferredDifficulty = options.preferredDifficulty ?? (() => DEFAULT_SOLO_DIFFICULTY);
  let difficulty = preferredDifficulty();
  const preferredBoardSize = options.preferredBoardSize ?? (() => DEFAULT_BOARD_SIZE);
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
      difficulty,
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

  const applyAction = (playerId: string, action: SoloAction): boolean => {
    if (!state || !record) {
      return false;
    }
    const result = resolveAction(
      state,
      { ...action, playerId },
      record.createdAt + record.actions.length + 1
    );
    if (!result.ok) {
      error = result.error;
      notify();
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
      if (
        disposed ||
        scheduledGeneration !== generation ||
        !state ||
        state.phase !== "live" ||
        state.currentTurnPlayerId !== SOLO_BOT_ID
      ) {
        return;
      }
      // A cancelled callback must not erase the current generation's timer handle.
      botTimer = null;
      const publicMatch = toMatchStateDto(state);
      let selected: SoloAction | null = null;
      try {
        selected = chooseAction(publicMatch, SOLO_BOT_ID, difficulty);
      } catch {
        // A bot failure must not leave its turn permanently pending.
      }
      const action = selected ?? fallbackAction(publicMatch);
      if (!action || !applyAction(SOLO_BOT_ID, action)) {
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

  const beginFresh = (nextStarter: "human" | "bot", notice: string | null): void => {
    cancelBot();
    starter = nextStarter;
    difficulty = preferredDifficulty();
    record = freshRecord(nextSeed() >>> 0, now(), starter, {
      difficulty,
      boardSize: preferredBoardSize()
    });
    state = createSoloState(record);
    bombArmed = false;
    error = null;
    recoveryNotice = notice;
    persist();
    scheduleBot();
    notify();
  };

  const restoreSaved = (): void => {
    const recovered = storage.read();
    const restored = recovered.record ? replaySoloRecord(recovered.record) : null;
    if (restored?.phase === "finished" && !options.keepFinished) {
      beginFresh("human", recovered.notice);
      return;
    }
    if (recovered.record && restored) {
      state = restored;
      record = { ...recovered.record, actions: [...recovered.record.actions] };
      starter = recovered.record.starter;
      difficulty = recovered.record.difficulty;
      recoveryNotice =
        recovered.notice ??
        setupNotice(
          state,
          { difficulty, boardSize: recovered.record.boardSize },
          { difficulty: preferredDifficulty(), boardSize: preferredBoardSize() }
        );
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
      if (options.startFresh) {
        beginFresh("human", null);
        return;
      }
      restoreSaved();
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
      if (!applyAction(SOLO_HUMAN_ID, action)) {
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
      if (
        !human ||
        !bot ||
        human.bombsRemaining === 0 ||
        bot.score - human.score < getBombDeficit(state.board.mineCount)
      ) {
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
