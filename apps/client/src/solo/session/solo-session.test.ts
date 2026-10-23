import { createMatchState } from "@minesweeper-flags/game-engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseSoloAction } from "../bot/solo-bot.js";
import {
  createBrowserSoloStorage,
  SOLO_STORAGE_KEY,
  type SoloStorage
} from "../storage/solo-storage.js";
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
    // Given spies on each browser network entry point.
    const spies = ["fetch", "WebSocket", "XMLHttpRequest", "RTCPeerConnection"].map((name) => {
      const spy = vi.fn();
      vi.stubGlobal(name, spy);
      return spy;
    });
    const replay: SoloReplayRecord = {
      version: 1,
      seed: 6,
      createdAt: 1,
      starter: "bot",
      actions: []
    };

    // When fresh and restored sessions start and a restored bot takes a fallback step.
    for (const saved of [null, replay]) {
      const scheduler = createScheduler();
      const session = createSoloSession({
        storage: createStorage(saved),
        scheduler,
        chooseAction: () => null
      });
      session.start();
      scheduler.runOne();
      session.dispose();
    }

    // Then creation, activation, restoration, and play attempt no network operation.
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
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

  it("restores a naturally won replay with deterministic action times", () => {
    // Given a replay that claims every winning mine on one retained human turn.
    const raw = createMatchState({
      roomId: "solo-local",
      players: [
        { playerId: SOLO_HUMAN_ID, displayName: "You" },
        { playerId: SOLO_BOT_ID, displayName: "Bot" }
      ],
      seed: 11,
      createdAt: 20,
      startingPlayerId: SOLO_HUMAN_ID
    });
    const actions = raw.board.cells
      .flat()
      .filter((cell) => cell.hasMine)
      .slice(0, 26)
      .map((cell) => ({
        type: "select" as const,
        playerId: SOLO_HUMAN_ID,
        row: cell.row,
        column: cell.column
      }));
    const replay = {
      version: 1 as const,
      seed: 11,
      createdAt: 20,
      starter: "human" as const,
      actions
    };

    // When two sessions restore it with different wall clocks.
    const first = createSoloSession({
      storage: createStorage(replay),
      scheduler: createScheduler(),
      now: () => 999
    });
    const second = createSoloSession({
      storage: createStorage(replay),
      scheduler: createScheduler(),
      now: () => 4
    });
    first.start();
    second.start();

    // Then both retain the finished game and the public result is identical.
    expect(first.getSnapshot().match.phase).toBe("finished");
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
  });

  it("keeps the cached snapshot and storage unchanged after disposal", () => {
    // Given a started session that is disposed.
    const storage = createStorage();
    const session = createSoloSession({
      storage,
      scheduler: createScheduler(),
      nextSeed: () => 12
    });
    session.start();
    const before = session.getSnapshot();
    const saved = storage.saved;
    session.dispose();

    // When every mutating command is attempted after navigation.
    session.restart();
    session.rematch();
    session.resign();
    session.toggleBombMode();
    session.submitCellAction(0, 0);

    // Then observable state retains stable identity and persistence is untouched.
    expect(session.getSnapshot()).toBe(before);
    expect(storage.saved).toEqual(saved);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const replayFor = (starter: "human" | "bot" = "bot"): SoloReplayRecord => ({
  version: 1,
  seed: 11,
  createdAt: 20,
  starter,
  actions: []
});

const boardFor = () =>
  createMatchState({
    roomId: "solo-local",
    players: [
      { playerId: SOLO_HUMAN_ID, displayName: "You" },
      { playerId: SOLO_BOT_ID, displayName: "Bot" }
    ],
    seed: 11,
    createdAt: 20,
    startingPlayerId: SOLO_BOT_ID
  }).board.cells.flat();

it("ignores a cancelled callback without losing the current generation timer", () => {
  // Given a scheduler that can deliver an already cancelled callback after two rematches.
  const callbacks: (() => void)[] = [];
  const clear = vi.fn();
  const chooseAction = vi.fn(() => null);
  const session = createSoloSession({
    storage: createStorage(replayFor()),
    scheduler: { set: (callback) => callbacks.push(callback), clear },
    chooseAction,
    nextSeed: () => 11,
    now: () => 20
  });
  session.start();
  session.rematch();
  session.rematch();
  const before = session.getSnapshot();

  // When the stale callback arrives and the current game is resigned.
  callbacks[0]!();
  const afterStale = session.getSnapshot();
  session.resign();

  // Then the stale callback makes no move and the current timer is still cancelled by resignation.
  expect(chooseAction).not.toHaveBeenCalled();
  expect(afterStale).toBe(before);
  expect(clear.mock.calls).toEqual([[1], [2]]);
  expect(session.getSnapshot().match.phase).toBe("finished");
});

it.each(["restart", "rematch", "resign", "dispose"] as const)(
  "cancels the pending browser timer on %s",
  (command) => {
    // Given an activated bot turn using browser timers.
    vi.useFakeTimers();
    const chooseAction = vi.fn(() => null);
    const session = createSoloSession({ storage: createStorage(replayFor()), chooseAction });
    session.start();
    const before = session.getSnapshot();

    // When the lifecycle command runs before the pending bot callback.
    session[command]();
    const timers = vi.getTimerCount();
    vi.runOnlyPendingTimers();

    // Then the pending timer is cancelled and never asks the bot to act.
    expect(timers).toBe(0);
    expect(chooseAction).not.toHaveBeenCalled();
    if (command === "dispose") expect(session.getSnapshot()).toBe(before);
    vi.useRealTimers();
  }
);

it("yields between retained mine claims and stops scheduling at a natural win", () => {
  // Given a bot that selects known fixture mines, one at a time, on a real engine board.
  const mines = boardFor()
    .filter((cell) => cell.hasMine)
    .slice(0, 26);
  const storage = createStorage(replayFor());
  const scheduler = createScheduler();
  const chooseAction = vi.fn(() => {
    const cell = mines[storage.saved!.actions.length]!;
    return { type: "select" as const, row: cell.row, column: cell.column };
  });
  const session = createSoloSession({ storage, scheduler, chooseAction });
  session.start();

  // When each scheduled callback is delivered separately.
  for (let index = 0; index < 26; index += 1) {
    expect(scheduler.size()).toBe(1);
    scheduler.runOne();

    // Then each callback resolves exactly one cell and yields until the winning move stops the bot.
    expect(storage.saved!.actions).toHaveLength(index + 1);
    expect(chooseAction).toHaveBeenCalledTimes(index + 1);
    expect(session.getSnapshot().match.phase).toBe(index === 25 ? "finished" : "live");
    expect(scheduler.size()).toBe(index === 25 ? 0 : 1);
  }
  session.submitCellAction(15, 15);
  expect(storage.saved!.actions).toHaveLength(26);
});

it("paces each retained mine claim with a 500 ms browser delay", () => {
  // Given a bot turn with two independently selected known mines on a real engine board.
  vi.useFakeTimers();
  const mines = boardFor()
    .filter((cell) => cell.hasMine)
    .slice(0, 2);
  const storage = createStorage(replayFor());
  const chooseAction = vi.fn(() => {
    const cell = mines[storage.saved!.actions.length]!;
    return { type: "select" as const, row: cell.row, column: cell.column };
  });
  const session = createSoloSession({ storage, chooseAction });
  session.start();

  // When the first timer is nearly due, then exactly due, then the next timer is nearly due.
  vi.advanceTimersByTime(499);
  expect(chooseAction).not.toHaveBeenCalled();
  expect(session.getSnapshot().match.lastAction).toBeNull();
  expect(session.getSnapshot().botThinking).toBe(true);
  vi.advanceTimersByTime(1);
  const afterFirstMine = session.getSnapshot();
  vi.advanceTimersByTime(499);

  // Then each mine claim is one action, retains the bot turn, and schedules another full delay.
  expect(chooseAction).toHaveBeenCalledTimes(1);
  expect(storage.saved!.actions).toHaveLength(1);
  expect(afterFirstMine.match.lastAction?.playerId).toBe(SOLO_BOT_ID);
  expect(afterFirstMine.match.currentTurnPlayerId).toBe(SOLO_BOT_ID);
  expect(afterFirstMine.botThinking).toBe(true);
  vi.advanceTimersByTime(1);
  expect(chooseAction).toHaveBeenCalledTimes(2);
  expect(storage.saved!.actions).toHaveLength(2);
  session.dispose();
  vi.useRealTimers();
});

it("lets the default bot draw its choices from the injected random source", () => {
  // Given a bot-started game, an injected random source, and a different global random
  const random = () => 0.05;
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const scheduler = createScheduler();
  const session = createSoloSession({ storage: createStorage(replayFor()), scheduler, random });
  session.start();
  const expected = chooseSoloAction(session.getSnapshot().match, SOLO_BOT_ID, { random });

  // When the bot takes its opening turn
  scheduler.runOne();
  vi.restoreAllMocks();

  // Then it plays the move that the injected random source selects
  const { lastAction } = session.getSnapshot().match;
  expect({ type: lastAction?.type, row: lastAction?.row, column: lastAction?.column }).toEqual(
    expected
  );
});

it("passes the bot turn after a safe reveal", () => {
  // Given a bot turn and a safe fixture cell selected by the bot.
  const safe = boardFor().find((cell) => !cell.hasMine)!;
  const storage = createStorage(replayFor());
  const scheduler = createScheduler();
  const session = createSoloSession({
    storage,
    scheduler,
    chooseAction: () => ({ type: "select", row: safe.row, column: safe.column })
  });
  session.start();

  // When the scheduled safe reveal runs.
  scheduler.runOne();

  // Then the human gets the turn and no further bot work is queued.
  expect(session.getSnapshot().match.lastAction?.outcome).toBe("safe_reveal");
  expect(session.getSnapshot().match.currentTurnPlayerId).toBe(SOLO_HUMAN_ID);
  expect(scheduler.size()).toBe(0);
});

it("allows a trailing human to bomb and passes the turn to the bot", () => {
  // Given a valid replay where the bot claims four mines and then reveals a safe cell.
  const cells = boardFor();
  const mines = cells.filter((cell) => cell.hasMine).slice(0, 4);
  const safe = cells.find((cell) => !cell.hasMine)!;
  const replay = replayFor();
  replay.actions = [...mines, safe].map((cell) => ({
    type: "select",
    playerId: SOLO_BOT_ID,
    row: cell.row,
    column: cell.column
  }));
  const storage = createStorage(replay);
  const scheduler = createScheduler();
  const session = createSoloSession({ storage, scheduler });
  session.start();
  const target = session
    .getSnapshot()
    .match.board.cells.flat()
    .find((cell) => cell.status === "hidden")!;

  // When the human arms and uses their eligible bomb.
  session.toggleBombMode();
  expect(session.getSnapshot().bombArmed).toBe(true);
  session.submitCellAction(target.row, target.column);

  // Then the bomb is consumed, disarmed, persisted, and followed by one bot turn.
  expect(session.getSnapshot().match.lastAction?.outcome).toBe("bomb_used");
  expect(session.getSnapshot().match.currentTurnPlayerId).toBe(SOLO_BOT_ID);
  expect(session.getSnapshot().bombArmed).toBe(false);
  expect(storage.saved!.actions.at(-1)?.type).toBe("bomb");
  expect(scheduler.size()).toBe(1);
});

it("refreshes during a bot turn and activates only once", () => {
  // Given saved progress after a human safe reveal and a disposed original session.
  vi.useFakeTimers();
  const safe = boardFor().find((cell) => !cell.hasMine)!;
  const storage = createStorage(replayFor("human"));
  const first = createSoloSession({ storage });
  first.start();
  first.submitCellAction(safe.row, safe.column);
  const before = first.getSnapshot().match;
  first.dispose();
  const chooseAction = vi.fn(() => null);
  const restored = createSoloSession({ storage, chooseAction });

  // When a new session is activated twice and its queued callback runs.
  restored.start();
  restored.start();
  expect(restored.getSnapshot().match).toEqual(before);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersToNextTimer();

  // Then restoration preserves progress and runs exactly one bounded fallback step.
  expect(chooseAction).toHaveBeenCalledTimes(1);
  expect(storage.saved!.actions).toHaveLength(2);
  expect(restored.getSnapshot().match.lastAction?.playerId).toBe(SOLO_BOT_ID);
  restored.dispose();
  vi.useRealTimers();
});

it.each(["get", "set", "remove", "getter", "absent"])(
  "keeps the session playable when browser storage fails at %s",
  (failure) => {
    // Given a denied browser storage path or an unavailable browser global.
    const fail = () => {
      throw new Error("denied");
    };
    const browserStorage = {
      getItem: failure === "get" ? fail : () => (failure === "remove" ? "{" : null),
      setItem: failure === "set" ? fail : vi.fn(),
      removeItem: failure === "remove" ? fail : vi.fn()
    };
    const browser =
      failure === "getter"
        ? Object.defineProperty({}, "sessionStorage", { get: fail })
        : { sessionStorage: browserStorage };
    vi.stubGlobal("window", failure === "absent" ? undefined : browser);
    const session = createSoloSession({
      storage: createBrowserSoloStorage(),
      scheduler: createScheduler(),
      nextSeed: () => 11,
      now: () => 20
    });
    const safe = boardFor().find((cell) => !cell.hasMine)!;

    // When the session starts and the human makes a legal move despite the storage failure.
    session.start();
    session.submitCellAction(safe.row, safe.column);

    // Then play advances locally with a truthful recovery notice.
    expect(session.getSnapshot().match.lastAction?.playerId).toBe(SOLO_HUMAN_ID);
    expect(session.getSnapshot().match.currentTurnPlayerId).toBe(SOLO_BOT_ID);
    expect(session.getSnapshot().recoveryNotice).toMatch(/cannot|invalid/);
    vi.unstubAllGlobals();
  }
);

it.each(["wrong turn", "repeat", "after win", "resign after win"])(
  "rejects the whole replay for %s after valid progress",
  (failure) => {
    // Given at least one valid mine claim followed by an inconsistent replay action or resignation.
    const mines = boardFor().filter((cell) => cell.hasMine);
    const replay = replayFor("human");
    replay.actions = mines.slice(0, failure.includes("win") ? 26 : 1).map((cell) => ({
      type: "select",
      playerId: SOLO_HUMAN_ID,
      row: cell.row,
      column: cell.column
    }));
    if (failure === "resign after win") replay.resignedBy = "human";
    else
      replay.actions.push({
        ...replay.actions[0]!,
        playerId: failure === "wrong turn" ? SOLO_BOT_ID : SOLO_HUMAN_ID
      });
    const browser = new Map([
      [SOLO_STORAGE_KEY, JSON.stringify(replay)],
      ["friend", "untouched"]
    ]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => browser.get(key) ?? null,
        setItem: (key: string, value: string) => browser.set(key, value),
        removeItem: (key: string) => browser.delete(key)
      }
    });
    const scheduler = createScheduler();
    const session = createSoloSession({
      storage: createBrowserSoloStorage(),
      scheduler,
      nextSeed: () => 11,
      now: () => 20
    });

    // When the complete replay is restored.
    session.start();

    // Then none of the valid prefix is applied and unrelated storage remains untouched.
    expect(session.getSnapshot().match.lastAction).toBeNull();
    expect(session.getSnapshot().match.players.map((player) => player.score)).toEqual([0, 0]);
    expect(session.getSnapshot().recoveryNotice).toContain("invalid");
    expect(browser.get("friend")).toBe("untouched");
    expect(scheduler.size()).toBe(0);
    vi.unstubAllGlobals();
  }
);

it("notifies subscribers with stable snapshots and respects unsubscribe", () => {
  // Given an active human session and an observer of its public snapshot.
  const session = createSoloSession({
    storage: createStorage(),
    scheduler: createScheduler(),
    nextSeed: () => 11
  });
  session.start();
  const initial = session.getSnapshot();
  const observer = vi.fn(() => session.getSnapshot());
  const unsubscribe = session.subscribe(observer);

  // When a legal move occurs and the observer unsubscribes before resignation.
  const mine = boardFor().find((cell) => cell.hasMine)!;
  session.submitCellAction(mine.row, mine.column);
  const updated = session.getSnapshot();
  unsubscribe();
  session.resign();

  // Then one notification exposes a new stable public snapshot and unsubscribe stops later notifications.
  expect(observer).toHaveBeenCalledTimes(1);
  expect(observer.mock.results[0]!.value).toBe(updated);
  expect(updated).not.toBe(initial);
  expect(updated.match.players[0].score).toBe(1);
  expect(updated.humanId).toBe(SOLO_HUMAN_ID);
  expect(updated.error).toBeNull();
});
