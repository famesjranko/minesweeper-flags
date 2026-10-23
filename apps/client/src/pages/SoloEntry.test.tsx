// @vitest-environment jsdom

import { createMatchState } from "@minesweeper-flags/game-engine";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SOLO_DIFFICULTY_KEY } from "../solo/storage/solo-difficulty-preference.js";
import { SOLO_STORAGE_KEY } from "../solo/storage/solo-storage.js";
import { HomePage } from "./HomePage.js";
import { SoloPage } from "./SoloPage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const oldReplay = {
  version: 1,
  seed: 11,
  createdAt: 20,
  starter: "human",
  difficulty: "easy",
  actions: []
};
let root: Root | undefined;
let container: HTMLDivElement;

const render = (page: "home" | "solo", strict = false) => {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const content =
    page === "home" ? (
      <HomePage friendContent={null} connectionStatus="connected" onFriendSelected={vi.fn()} />
    ) : (
      <SoloPage />
    );
  act(() => root?.render(strict ? <StrictMode>{content}</StrictMode> : content));
};

const reload = (strict = false) => {
  act(() => root?.unmount());
  root = createRoot(container);
  render("solo", strict);
};

const followEntry = (label: string, strict = false) => {
  const link = [...container.querySelectorAll<HTMLAnchorElement>(".solo-entry-primary")].find(
    (candidate) => candidate.textContent === label
  );
  expect(link).toBeDefined();
  window.history.replaceState(null, "", link!.href);
  reload(strict);
};
const botLabel = () => container.querySelectorAll(".sidebar-player-header")[1]?.textContent;
const saved = () => window.sessionStorage.getItem(SOLO_STORAGE_KEY);
const pickHard = () =>
  act(() => container.querySelector<HTMLInputElement>("input[value='hard']")!.click());

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

it.each([false, true])(
  "honors the current lobby choice with denied preference writes and denied reads=%s",
  (denyReads) => {
    // Given an Easy preference whose writes and optionally reads are denied.
    window.localStorage.setItem(SOLO_DIFFICULTY_KEY, "easy");
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (denyReads && key === SOLO_DIFFICULTY_KEY) throw new Error("denied");
      return get.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === SOLO_DIFFICULTY_KEY) throw new Error("denied");
      set.call(this, key, value);
    });
    render("home");

    // When the player selects Hard and follows the rendered Start solo match link.
    pickHard();
    followEntry("Start solo match");

    // Then the current match uses Hard even though the lasting preference cannot change.
    expect(botLabel()).toBe("RED · Hard");
    expect(JSON.parse(saved()!).difficulty).toBe("hard");
  }
);

it.each([false, true])(
  "keeps the requested new game when progress writes fail with StrictMode=%s",
  (strict) => {
    // Given readable Easy progress and denied progress writes with deterministic fresh boards.
    window.sessionStorage.setItem(SOLO_STORAGE_KEY, JSON.stringify(oldReplay));
    vi.spyOn(Math, "random").mockReturnValueOnce(0.25).mockReturnValue(0.75);
    const attempts: (typeof oldReplay)[] = [];
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === SOLO_STORAGE_KEY) {
        attempts.push(JSON.parse(value));
        throw new Error("denied");
      }
      set.call(this, key, value);
    });
    render("home");

    // When the player selects Hard and follows Start new through effect reactivation.
    pickHard();
    followEntry("Start new", strict);

    // Then the selected game stays active and the failed save remains visible.
    expect(botLabel()).toBe("RED · Hard");
    expect(container.querySelector(".solo-notice")?.textContent).toBe(
      "Solo progress cannot be saved in this browser."
    );
    expect(window.location.search).toBe("");
    const first = attempts[0]!;
    const mine = createMatchState({
      roomId: "solo-local",
      players: [
        { playerId: "solo-human", displayName: "You" },
        { playerId: "solo-bot", displayName: "Bot" }
      ],
      seed: first.seed,
      createdAt: first.createdAt,
      startingPlayerId: "solo-human"
    })
      .board.cells.flat()
      .find((cell) => cell.hasMine)!;

    // When the player selects a mine on that first new board.
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          `button[title='Row ${mine.row + 1}, Column ${mine.column + 1}']`
        )!
        .click()
    );

    // Then the same seed and level are used and the mine keeps the human turn.
    expect(attempts.at(-1)).toMatchObject({
      seed: first.seed,
      difficulty: "hard",
      actions: [{ playerId: "solo-human", type: "select", row: mine.row, column: mine.column }]
    });
    expect(container.textContent).not.toContain("Bot thinking");
    expect(saved()).toBe(JSON.stringify(oldReplay));

    // When a real reload creates a separate page mount.
    reload();

    // Then the old durable replay returns without repeating the consumed new-game intent.
    expect(botLabel()).toBe("RED · Easy");
    expect(window.location.search).toBe("");
    expect(saved()).toBe(JSON.stringify(oldReplay));
  }
);

it.each(["Return to game", "Start new"])(
  "follows %s at its correct level and restores it on refresh",
  (entry) => {
    // Given an existing Easy replay and a newly selected Hard level.
    window.sessionStorage.setItem(SOLO_STORAGE_KEY, JSON.stringify(oldReplay));
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    render("home");
    pickHard();

    // When the player follows the rendered entry link and refreshes the game.
    followEntry(entry, true);
    const beforeRefresh = saved();
    reload();

    // Then Return keeps the old game while Start new replaces it at Hard exactly once.
    expect(botLabel()).toBe(entry === "Return to game" ? "RED · Easy" : "RED · Hard");
    expect(saved()).toBe(beforeRefresh);
    expect(JSON.parse(saved()!).seed).toBe(entry === "Return to game" ? 11 : 0x40000000);
    expect(window.location.search).toBe("");
  }
);

it.each(["/solo", "/solo?difficulty=invalid&new=invalid", "/solo?difficulty=__proto__"])(
  "uses safe defaults for legacy or invalid entry %s",
  (route) => {
    // Given no saved game and an invalid lasting preference.
    window.localStorage.setItem(SOLO_DIFFICULTY_KEY, "invalid");
    window.history.replaceState(null, "", route);

    // When a legacy or invalid solo route opens.
    render("solo", true);

    // Then a Normal match starts without trusting invalid route values.
    expect(botLabel()).toBe("RED · Normal");
    expect(JSON.parse(saved()!).difficulty).toBe("normal");
  }
);

it("does not treat an invalid new-game value as Start new", () => {
  // Given readable Easy progress and untrusted route intent for Hard.
  window.sessionStorage.setItem(SOLO_STORAGE_KEY, JSON.stringify(oldReplay));
  window.history.replaceState(null, "", "/solo?new=invalid&difficulty=hard");

  // When the solo route opens.
  render("solo", true);

  // Then the saved Easy game remains authoritative.
  expect(botLabel()).toBe("RED · Easy");
  expect(saved()).toBe(JSON.stringify(oldReplay));
});
