import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoloStorage } from "../storage/solo-storage.js";
import { createSoloSession } from "./solo-session.js";
import {
  SOLO_BOT_ID,
  SOLO_HUMAN_ID,
  type SoloReplayRecord,
  type SoloScheduler
} from "./solo-session.types.js";

const createStorage = (
  initial: SoloReplayRecord | null = null
): SoloStorage & { saved: SoloReplayRecord | null } => {
  let saved = initial;
  return {
    get saved() {
      return saved;
    },
    read: () => ({ record: saved, notice: null }),
    write: (record) => {
      saved = structuredClone(record);
      return null;
    },
    clear: () => {
      saved = null;
    }
  };
};

const createScheduler = (): SoloScheduler & { runOne: () => void; size: () => number } => {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  return {
    set: (callback) => {
      next += 1;
      callbacks.set(next, callback);
      return next;
    },
    clear: (handle) => {
      callbacks.delete(handle as number);
    },
    runOne: () => {
      const entry = callbacks.entries().next().value as [number, () => void] | undefined;
      if (entry) {
        callbacks.delete(entry[0]);
        entry[1]();
      }
    },
    size: () => callbacks.size
  };
};

describe("solo session", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts and restores without invoking browser network APIs", () => {
    // Given browser network APIs that record every attempted connection.
    const fetch = vi.fn();
    const webSocket = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", webSocket);
    const replay = {
      version: 1 as const,
      seed: 6,
      createdAt: 1,
      starter: "human" as const,
      actions: []
    };

    // When a local session starts from a valid replay.
    const session = createSoloSession({
      storage: createStorage(replay),
      scheduler: createScheduler()
    });
    session.start();

    // Then the local authority has not attempted any browser network call.
    expect(fetch).not.toHaveBeenCalled();
    expect(webSocket).not.toHaveBeenCalled();
  });

  it("yields one bot action and cancels queued work on restart, resign, and dispose", () => {
    // Given a bot-started game with a deterministic scheduler and a bot fallback.
    const scheduler = createScheduler();
    const storage = createStorage({
      version: 1,
      seed: 1,
      createdAt: 1,
      starter: "bot",
      actions: []
    });
    const session = createSoloSession({
      scheduler,
      storage,
      now: () => 2,
      nextSeed: () => 2,
      chooseAction: () => {
        throw new Error("bot failed");
      }
    });

    // When the queued bot action runs, then restart, resign, and dispose occur.
    session.start();
    expect(scheduler.size()).toBe(1);
    scheduler.runOne();
    const afterBot = session.getSnapshot();
    session.restart();
    session.resign();
    session.dispose();
    scheduler.runOne();

    // Then exactly one fallback bot action ran and no stale callback can mutate the new state.
    expect(afterBot.match.lastAction?.playerId).toBe(SOLO_BOT_ID);
    expect(afterBot.match.currentTurnPlayerId).toBe(SOLO_HUMAN_ID);
    expect(session.getSnapshot().match.phase).toBe("finished");
    expect(scheduler.size()).toBe(0);

    const queuedScheduler = createScheduler();
    const queued = createSoloSession({
      scheduler: queuedScheduler,
      storage: createStorage({ version: 1, seed: 3, createdAt: 1, starter: "bot", actions: [] })
    });
    queued.start();
    queued.restart();
    expect(queuedScheduler.size()).toBe(0);
  });

  it("restores a valid bot turn, rejects invalid replay atomically, and safely ignores double start", () => {
    // Given a valid bot-turn replay and a second replay whose first action has the wrong actor.
    const scheduler = createScheduler();
    const valid = {
      version: 1 as const,
      seed: 2,
      createdAt: 1,
      starter: "bot" as const,
      actions: []
    };
    const session = createSoloSession({
      scheduler,
      storage: createStorage(valid),
      now: () => 3,
      nextSeed: () => 4,
      chooseAction: () => null
    });
    const invalid = createStorage({
      ...valid,
      actions: [{ type: "select", playerId: SOLO_HUMAN_ID, row: 0, column: 0 }]
    });
    const invalidSession = createSoloSession({
      scheduler: createScheduler(),
      storage: invalid,
      now: () => 3,
      nextSeed: () => 4
    });

    // When sessions start, including a repeated start on the valid session.
    session.start();
    session.start();
    invalidSession.start();

    // Then refresh schedules one bot step, while invalid replay is reset as a fresh local game.
    expect(scheduler.size()).toBe(1);
    expect(invalid.saved).not.toBeNull();
    expect(invalidSession.getSnapshot().recoveryNotice).toContain("invalid");
    expect(invalidSession.getSnapshot().match.currentTurnPlayerId).toBe(SOLO_HUMAN_ID);
  });

  it("records human actions, refuses non-human turns, and alternates the rematch starter", () => {
    // Given a fresh human-started local game.
    const scheduler = createScheduler();
    const storage = createStorage();
    const session = createSoloSession({
      scheduler,
      storage,
      now: () => 5,
      nextSeed: () => 5,
      chooseAction: () => null
    });

    // When a human resolves a cell and then requests a rematch.
    session.start();
    session.submitCellAction(0, 0);
    const afterHuman = session.getSnapshot();
    const savedAfterHuman = storage.saved;
    session.submitCellAction(1, 1);
    session.rematch();

    // Then the successful action is persisted, bot-turn input is rejected, and the bot starts the rematch.
    expect(savedAfterHuman?.actions).toHaveLength(1);
    expect(afterHuman.match.currentTurnPlayerId).toBe(SOLO_BOT_ID);
    expect(session.getSnapshot().match.currentTurnPlayerId).toBe(SOLO_BOT_ID);
    expect(scheduler.size()).toBe(1);
  });

  it("restores an explicit resignation as a finished local game", () => {
    // Given a session that saves a human resignation.
    const storage = createStorage();
    const first = createSoloSession({
      storage,
      scheduler: createScheduler(),
      now: () => 8,
      nextSeed: () => 9
    });
    first.start();
    first.resign();
    expect(storage.saved?.resignedBy).toBe("human");

    // When a new session restores the saved replay.
    const restored = createSoloSession({ storage, scheduler: createScheduler(), now: () => 10 });
    restored.start();

    // Then the match stays finished and no bot callback is scheduled.
    expect(restored.getSnapshot().match.phase).toBe("finished");
    expect(restored.getSnapshot().match.winnerPlayerId).toBe(SOLO_BOT_ID);
  });
});
