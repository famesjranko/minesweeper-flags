// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LAST_MOVE_MARKS } from "../../entities/board/last-move.js";
import { BOARD_ZOOM_KEY } from "./board-zoom-preference.js";
import { MatchPlayArea } from "./MatchPlayArea.js";
import { getMatchPresentation } from "./match-presentation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMatch = (overrides: Partial<MatchStateDto> = {}): MatchStateDto => ({
  roomId: "room",
  phase: "live",
  board: {
    rows: 2,
    columns: 2,
    mineCount: 1,
    cells: [0, 1].map((row) =>
      [0, 1].map((column) => ({
        row,
        column,
        status: "hidden" as const,
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  },
  players: [
    {
      playerId: "me",
      displayName: "Ana",
      score: 2,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "them",
      displayName: "Bo",
      score: 6,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: "me",
  turnPhase: "awaiting_action",
  turnNumber: 3,
  winnerPlayerId: null,
  lastAction: null,
  ...overrides
});

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
const onResign = vi.fn();
const onRequestRematch = vi.fn();
const scrollIntoView = vi.fn();

type Connection = "connected" | "connecting" | "disconnected";

const Scene = ({
  match,
  connection = "connected"
}: {
  match: MatchStateDto;
  connection?: Connection;
}) => {
  const [bombArmed, setBombArmed] = useState(false);
  return (
    <MatchPlayArea
      match={match}
      currentPlayerId="me"
      bombArmed={bombArmed}
      view={getMatchPresentation({
        match,
        currentPlayerId: "me",
        bombArmed,
        connectionStatus: connection
      })}
      lastMove={NO_LAST_MOVE_MARKS}
      onToggleBomb={() => setBombArmed(!bombArmed)}
      onCellSelect={(row, column) => {
        setBombArmed(false);
        onSelect(row, column);
      }}
      onRequestRematch={onRequestRematch}
      onCancelRematch={() => {}}
      onResign={onResign}
      resignDisabled={connection !== "connected"}
    />
  );
};

const render = (match = createMatch(), connection: Connection = "connected") =>
  act(() => root.render(<Scene match={match} connection={connection} />));
const hint = () => container.querySelector("[role=status]")?.textContent;
const bomb = () => container.querySelector<HTMLButtonElement>("button.inline-bomb")!;
const cell = (row: number, column: number) =>
  container.querySelector<HTMLButtonElement>(`[data-cell="${row}-${column}"]`)!;
const named = (name: string) => container.querySelector<HTMLButtonElement>(`button[name=${name}]`);
const tap = (target: HTMLElement) =>
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    target.click();
  });

beforeEach(() => {
  if (!("PointerEvent" in window)) vi.stubGlobal("PointerEvent", MouseEvent);
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  window.dispatchEvent(new MouseEvent("pointerdown"));
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onSelect.mockClear();
  onResign.mockClear();
  onRequestRematch.mockClear();
  vi.unstubAllGlobals();
});

describe("status strip wording", () => {
  it("says the opponent is moving while they are online", () => {
    // Given the opponent holds the turn and is connected
    // When the strip renders
    render(createMatch({ currentTurnPlayerId: "them" }));

    // Then it names who is moving
    expect(hint()).toBe("Bo is moving…");
  });

  it("says the opponent is offline rather than moving", () => {
    // Given the opponent holds the turn and has disconnected
    const match = createMatch({ currentTurnPlayerId: "them" });
    match.players[1].connected = false;

    // When the strip renders
    render(match);

    // Then it tells the truth about the wait
    expect(hint()).toBe("Bo is offline. Waiting for them to return.");
  });

  it("blames the absent opponent when a direct-match host cannot move because of them", () => {
    // Given a direct-match host on its own turn, whose guest has dropped
    const match = createMatch();
    match.players[1].connected = false;

    // When the host's link reports down, because that link was the guest
    render(match, "disconnected");

    // Then the strip gives the real reason rather than blaming the host's connection
    expect(hint()).toBe("Bo is offline. Waiting for them to return.");
  });

  it("keeps the player's own turn message when only the opponent is offline", () => {
    // Given the player holds the turn while the opponent is away
    const match = createMatch();
    match.players[1].connected = false;

    // When the strip renders
    render(match);

    // Then the player can still move
    expect(hint()).toContain("Your turn");
  });

  it.each([
    ["their own turn", "me"],
    ["the opponent's turn", "them"]
  ])("says reconnecting when the player's connection drops on %s", (_name, currentTurnPlayerId) => {
    // Given the player has lost the connection
    // When the strip renders
    render(createMatch({ currentTurnPlayerId }), "connecting");

    // Then it blames neither player
    expect(hint()).toBe("Reconnecting…");
  });
});

describe("telling apart the two kinds of lost link", () => {
  const hintFor = (connectionStatus: "connecting" | "disconnected") => {
    const match = createMatch({ currentTurnPlayerId: "them" });
    match.players[1].connected = false;
    return getMatchPresentation({
      match,
      currentPlayerId: "me",
      bombArmed: false,
      connectionStatus
    }).turnHint;
  };

  it("reports the player's own outage even when the opponent is already offline", () => {
    // Given an opponent who has left, and a client now retrying its own connection
    // When the strip is worked out
    const hint = hintFor("connecting");

    // Then the player learns that the problem is theirs
    expect(hint).toBe("Reconnecting…");
  });

  it("promises no retry when the client has stopped trying", () => {
    // Given a tab displaced by another tab, with the opponent still present
    const match = createMatch();

    // When the strip is worked out
    const { turnHint, connectionNotice } = getMatchPresentation({
      match,
      currentPlayerId: "me",
      bombArmed: false,
      connectionStatus: "disconnected"
    });

    // Then it states only what is true, in the strip and on a blocked rematch
    expect(turnHint).toBe("Connection lost.");
    expect(connectionNotice).toBe("Connection lost.");
  });

  it("names the absent opponent when that was the host's only link", () => {
    // Given a direct-match host, which does not retry, whose guest has gone
    // When the strip is worked out
    const hint = hintFor("disconnected");

    // Then the opponent is the reason
    expect(hint).toBe("Bo is offline. Waiting for them to return.");
  });
});

describe("explaining an unavailable bomb", () => {
  const locked = () => {
    const match = createMatch();
    match.players[1].score = match.players[0].score + 1;
    return match;
  };

  it("puts the locked bomb's reason in the strip when tapped", () => {
    // Given a bomb that has not unlocked
    render(locked());

    // When the player taps it
    act(() => bomb().click());

    // Then the strip shows the same text the tooltip gives on desktop
    expect(hint()).toBe(bomb().getAttribute("aria-label"));
    expect(hint()).toContain("trailing by 4 or more");
    expect(bomb().getAttribute("aria-pressed")).toBe("false");
  });

  it("drops the reason when the turn moves on", () => {
    // Given the strip is showing a bomb's reason
    render(locked());
    act(() => bomb().click());

    // When the next turn arrives
    render({ ...locked(), turnNumber: 4, currentTurnPlayerId: "them" });

    // Then the strip shows the live turn again
    expect(hint()).toBe("Bo is moving…");
  });

  it("drops the reason when the player makes a move", () => {
    // Given the strip is showing a bomb's reason
    render(locked());
    act(() => bomb().click());

    // When the player opens a square in the same turn
    act(() => cell(0, 0).click());

    // Then the strip stops showing it
    expect(hint()).toContain("Your turn");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(0, 0);
  });
});

describe("aiming the bomb on touch", () => {
  const aim = () => {
    render();
    act(() => bomb().click());
    tap(cell(1, 1));
  };

  it("swaps Resign for Cancel and Fire bomb once a square is aimed", () => {
    // Given an armed bomb
    render();
    act(() => bomb().click());
    expect(hint()).toBe("Bomb armed · tap a square");
    expect(named("resign")).not.toBeNull();

    // When the player taps a square
    tap(cell(1, 1));

    // Then the preview shows, nothing fires, and the confirm buttons replace Resign
    expect(onSelect).not.toHaveBeenCalled();
    expect(hint()).toBe("Bomb aimed. Tap another hidden square to move it.");
    expect(container.querySelector(".board-bomb-preview")).not.toBeNull();
    expect(named("resign")).toBeNull();
    expect(named("cancel-bomb")?.textContent).toBe("Cancel");
    expect(named("fire-bomb")?.textContent).toBe("Fire bomb");
    expect(container.querySelector(".arcade-bomb-cancel")).toBeNull();
  });

  it("moves the aim with another tap", () => {
    // Given a square is aimed at
    aim();

    // When the player taps a different square
    tap(cell(0, 0));

    // Then the preview follows and still nothing fires
    expect(cell(0, 0).classList.contains("bomb-preview-center")).toBe(true);
    expect(cell(1, 1).classList.contains("bomb-preview-center")).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires at the aimed square and restores Resign", () => {
    // Given a square is aimed at
    aim();

    // When the player presses Fire bomb
    act(() => named("fire-bomb")?.click());

    // Then that square receives the bomb and the normal controls return
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(named("fire-bomb")).toBeNull();
    expect(named("resign")).not.toBeNull();
  });

  it("cancels without firing and forgets the aim", () => {
    // Given a square is aimed at
    aim();

    // When the player cancels and arms the bomb again
    act(() => named("cancel-bomb")?.click());
    expect(named("resign")).not.toBeNull();
    expect(document.activeElement).toBe(bomb());
    act(() => bomb().click());

    // Then nothing fired and the old aim did not come back
    expect(onSelect).not.toHaveBeenCalled();
    expect(hint()).toBe("Bomb armed · tap a square");
    expect(container.querySelector(".board-bomb-preview")).toBeNull();
  });

  it("drops the aim when the connection is lost", () => {
    // Given a square is aimed at
    aim();

    // When the connection drops
    render(createMatch(), "connecting");

    // Then nothing can fire
    expect(named("fire-bomb")).toBeNull();
    expect(hint()).toBe("Reconnecting…");
  });
});

describe("the board zoom choice", () => {
  const zoomButton = () => container.querySelector<HTMLButtonElement>(".arcade-zoom-button")!;

  it("is remembered for the next match on this device", () => {
    // Given a player who zooms the board
    render();
    act(() => zoomButton().click());

    // When the play area mounts again
    act(() => root.unmount());
    root = createRoot(container);
    render();

    // Then the board starts zoomed
    expect(window.localStorage.getItem(BOARD_ZOOM_KEY)).toBe("on");
    expect(container.querySelector(".arcade-board-viewport.is-zoomed")).not.toBeNull();
  });

  it("starts fitted for a player who never zoomed", () => {
    // Given no stored choice
    // When the play area mounts
    render();

    // Then the board fits the screen
    expect(container.querySelector(".arcade-board-viewport.is-zoomed")).toBeNull();
  });

  it("still zooms when browser storage is blocked", () => {
    // Given a browser that blocks storage
    const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("Storage blocked");
    });

    // When the player zooms the board
    render();
    act(() => zoomButton().click());

    // Then it zooms for this visit
    expect(container.querySelector(".arcade-board-viewport.is-zoomed")).not.toBeNull();
    storage.mockRestore();
  });
});

describe("double taps on the action slot", () => {
  // A real tap has detail 1; keyboard and assistive-technology clicks have detail 0.
  const realTap = (target: HTMLElement | null, atMs: number, clientY = 0) => {
    const time = vi.spyOn(Event.prototype, "timeStamp", "get").mockReturnValue(atMs);
    act(() => {
      target?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientY })
      );
    });
    time.mockRestore();
  };

  it.each([130, 250, 520, 799])("cannot forfeit with a second tap %ims after Resign", (gapMs) => {
    // Given a live match
    render();

    // When the player double-taps Resign, whose right half becomes Confirm resign
    realTap(named("resign"), 1000);
    realTap(named("confirm-resign"), 1000 + gapMs);

    // Then the prompt is still open and nothing was resigned
    expect(onResign).not.toHaveBeenCalled();
    expect(named("confirm-resign")).not.toBeNull();
  });

  it("cannot forfeit by tapping repeatedly", () => {
    // Given a live match
    render();

    // When the player keeps tapping the same spot every 200ms
    realTap(named("resign"), 1000);
    for (const atMs of [1200, 1400, 1600, 1800, 2000]) realTap(named("confirm-resign"), atMs);

    // Then every extra tap restarted the wait, and nothing was resigned
    expect(onResign).not.toHaveBeenCalled();
  });

  it("still resigns when the player presses Confirm deliberately", () => {
    // Given the resign prompt is open
    render();
    realTap(named("resign"), 1000);

    // When the player confirms after reading it
    realTap(named("confirm-resign"), 1900);

    // Then the match is resigned
    expect(onResign).toHaveBeenCalledOnce();
  });

  it("lets the player back out at once", () => {
    // Given the player tapped Resign by mistake
    render();
    realTap(named("resign"), 1000);

    // When they press Keep playing straight away
    realTap(named("keep-playing"), 1100);

    // Then the prompt closes without a second try
    expect(named("confirm-resign")).toBeNull();
    expect(named("resign")).not.toBeNull();
  });

  const touchTile = (target: HTMLElement, atMs: number) => {
    act(() => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })
      );
    });
    realTap(target, atMs);
  };

  it.each([
    ["Fire bomb", "fire-bomb"],
    ["Cancel", "cancel-bomb"]
  ])(
    "ignores the second tap of a double tap on a tile when %s appears under it",
    (_name, control) => {
      // Given an armed bomb
      render();
      act(() => bomb().click());

      // When the player double-taps a low tile, and the pinned control appears under the finger
      touchTile(cell(1, 1), 1000);
      realTap(named(control), 1110);

      // Then the bomb has not fired
      expect(onSelect).not.toHaveBeenCalled();

      // And the aim is still waiting for a decision
      expect(named("fire-bomb")).not.toBeNull();
    }
  );

  it("keeps ignoring repeated taps at the same spot, so a triple tap cannot fire", () => {
    // Given an armed bomb
    render();
    act(() => bomb().click());

    // When the player taps a low tile three times, with Fire bomb now under the finger
    touchTile(cell(1, 1), 1000);
    realTap(named("fire-bomb"), 1211);
    realTap(named("fire-bomb"), 1435);

    // Then the bomb has not fired
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires at once when Fire bomb is nowhere near the tile that was tapped", () => {
    // Given an armed bomb on a tall phone, where Fire bomb sits far below the tile
    render();
    act(() => bomb().click());

    // When the player aims at a tile, then quickly taps Fire bomb elsewhere on the screen
    touchTile(cell(1, 1), 1000);
    realTap(named("fire-bomb"), 1200, 300);

    // Then the bomb fires at the aimed square
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1, 1);
  });

  it("fires when the player taps Fire bomb promptly but deliberately after aiming", () => {
    // Given an armed bomb
    render();
    act(() => bomb().click());

    // When the player aims, then taps Fire bomb half a second later
    touchTile(cell(1, 1), 1000);
    realTap(named("fire-bomb"), 1500);

    // Then the bomb fires at the aimed square
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1, 1);
  });

  it("does not request a rematch from a double tap on the winning tile", () => {
    // Given a live match about to be won by the next tile
    render();

    // When the player double-taps the tile, and the rematch action appears under the finger
    touchTile(cell(1, 1), 1000);
    render(
      createMatch({
        phase: "finished",
        turnPhase: "ended",
        currentTurnPlayerId: null,
        winnerPlayerId: "me"
      })
    );
    realTap(container.querySelector(".match-primary-action"), 1110);

    // Then no rematch was requested
    expect(onRequestRematch).not.toHaveBeenCalled();

    // And a deliberate tap after the wait still works, as the ignored tap extended it
    realTap(container.querySelector(".match-primary-action"), 1600);
    expect(onRequestRematch).toHaveBeenCalledOnce();
  });

  it("does not let a double tap on Fire bomb open the resign prompt", () => {
    // Given a square is aimed at
    render();
    act(() => bomb().click());
    tap(cell(1, 1));

    // When the player double-taps Fire bomb, and Resign replaces it under the finger
    realTap(named("fire-bomb"), 1000);
    realTap(named("resign"), 1200);

    // Then the bomb fired once and no prompt opened
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(named("resign")).not.toBeNull();
    expect(named("confirm-resign")).toBeNull();
  });
});

describe("keyboard paths out of the bomb and the match", () => {
  const pressEscape = (target: Element) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

  it.each([
    ["the bomb button", () => bomb()],
    ["a board cell", () => cell(1, 1)]
  ])("disarms with Escape from %s and returns focus to the bomb", (_name, target) => {
    // Given an armed bomb
    render();
    act(() => bomb().click());
    expect(bomb().getAttribute("aria-pressed")).toBe("true");

    // When the player presses Escape
    pressEscape(target());

    // Then the bomb is safe again and focus is on it
    expect(bomb().getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(bomb());
  });

  it("does not scroll the page when focus returns to the bomb", () => {
    // Given a short phone where the page is scrolled down to the aim buttons
    render();
    act(() => bomb().click());
    tap(cell(1, 1));
    const focus = vi.spyOn(bomb(), "focus");

    // When the player cancels
    act(() => named("cancel-bomb")?.click());

    // Then focus moves without pulling the page back to the top
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("leaves an unarmed bomb alone on Escape", () => {
    // Given a bomb that is ready but not armed
    render();

    // When the player presses Escape on the board
    pressEscape(cell(0, 0));

    // Then Escape does not arm it
    expect(bomb().getAttribute("aria-pressed")).toBe("false");
  });

  const finished = () =>
    createMatch({
      phase: "finished",
      currentTurnPlayerId: null,
      turnPhase: "ended",
      winnerPlayerId: "them"
    });
  const primary = () => container.querySelector<HTMLButtonElement>(".match-primary-action");

  it("moves focus to the next action when Confirm resign disappears", () => {
    // Given a keyboard player whose focused Confirm resign is about to leave the page
    render();
    act(() => named("resign")?.click());
    act(() => named("confirm-resign")?.focus());

    // When the match ends and the button unmounts
    render(finished());

    // Then focus lands on the action that replaced it
    expect(document.activeElement).toBe(primary());
  });

  it("moves focus to the board when a new match starts", () => {
    // Given a keyboard player whose focused rematch button is about to leave the page
    render(finished());
    act(() => primary()?.focus());

    // When the rematch begins and the button unmounts
    render();

    // Then focus lands on the board's tab stop
    expect(document.activeElement).toBe(cell(0, 0));
  });

  it("does not pull focus away from a square the player is on", () => {
    // Given a keyboard player reading the board
    render();
    act(() => cell(0, 1).focus());

    // When the match ends
    render(finished());

    // Then their place on the board is kept
    expect(document.activeElement).toBe(cell(0, 1));
  });

  it("does not grab focus when a finished match is reopened", () => {
    // Given a refresh on a finished match
    // When the play area mounts
    render(finished());

    // Then the page keeps its normal starting focus
    expect(document.activeElement).toBe(document.body);
  });
});

describe("focus when the first match appears", () => {
  it("lands on the board for a keyboard player, such as after Join game", () => {
    // Given a keyboard player whose focused Join game button has just left the page
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    // When the live match mounts
    render();

    // Then arrow keys and Enter work straight away
    expect(document.activeElement).toBe(cell(0, 0));
  });

  it("lands on the next action for a keyboard player arriving at a finished match", () => {
    // Given a keyboard player following a link back to a match that has ended
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    // When the play area mounts
    render(
      createMatch({
        phase: "finished",
        currentTurnPlayerId: null,
        turnPhase: "ended",
        winnerPlayerId: "them"
      })
    );

    // Then focus is on the action they can take
    expect(document.activeElement).toBe(container.querySelector(".match-primary-action"));
  });

  it("draws no focus ring for a touch player", () => {
    // Given a player who last used a pointer, even after using keys earlier
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    window.dispatchEvent(new MouseEvent("pointerdown"));

    // When the live match mounts
    render();

    // Then no tile takes focus
    expect(document.activeElement).toBe(document.body);
  });
});

describe("a rematch that cannot be sent", () => {
  const finished = () =>
    createMatch({
      phase: "finished",
      currentTurnPlayerId: null,
      turnPhase: "ended",
      winnerPlayerId: "them"
    });
  const SceneBlocked = ({
    match,
    connection = "connecting"
  }: {
    match: MatchStateDto;
    connection?: Connection;
  }) => (
    <MatchPlayArea
      match={match}
      currentPlayerId="me"
      bombArmed={false}
      view={getMatchPresentation({
        match,
        currentPlayerId: "me",
        bombArmed: false,
        connectionStatus: connection
      })}
      lastMove={NO_LAST_MOVE_MARKS}
      onToggleBomb={() => {}}
      onCellSelect={() => {}}
      onRequestRematch={onRequest}
      onCancelRematch={() => {}}
      onResign={() => {}}
      resignDisabled
    />
  );
  const onRequest = vi.fn();
  const rematch = () => container.querySelector<HTMLButtonElement>(".match-primary-action")!;

  it("says the guest has gone rather than failing when pressed", () => {
    // Given a direct-match host after a finished match, whose guest has left
    const match = finished();
    match.players[1].connected = false;

    // When the rematch control renders and the host presses it
    act(() => root.render(<SceneBlocked match={match} connection="disconnected" />));
    act(() => rematch().click());

    // Then it is plainly unavailable, with the reason, and nothing is sent
    expect(rematch().getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelector(".match-rematch-action [role=status]")?.textContent).toBe(
      "Bo is offline. Waiting for them to return."
    );
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("says reconnecting when it is the player's own connection", () => {
    // Given a player whose own connection dropped after the match
    // When the rematch control renders
    act(() => root.render(<SceneBlocked match={finished()} />));

    // Then the reason is the connection
    expect(rematch().getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelector(".match-rematch-action [role=status]")?.textContent).toBe(
      "Reconnecting…"
    );
  });

  it("stays available when nothing blocks it", () => {
    // Given a connected player after a finished match
    // When the rematch control renders
    render(finished());

    // Then the player can press it
    expect(rematch().hasAttribute("aria-disabled")).toBe(false);
  });

  it("explains a long wait when the opponent has left a server match", () => {
    // Given a connected player who asked for a rematch, whose opponent then left
    const match = finished();
    match.players[0].rematchRequested = true;
    match.players[1].connected = false;

    // When the rematch control renders
    render(match);

    // Then the reason replaces "Waiting for Bo…", and the player can still cancel
    expect(container.querySelector(".match-rematch-action [role=status]")?.textContent).toBe(
      "Bo is offline. Waiting for them to return."
    );
    expect(rematch().textContent).toBe("Cancel rematch");
    expect(rematch().hasAttribute("aria-disabled")).toBe(false);
  });

  it("keeps keyboard focus on the button when it becomes blocked", () => {
    // Given a keyboard player on the rematch button
    render(finished());
    act(() => rematch().focus());

    // When the connection drops and the button is blocked
    render(finished(), "connecting");

    // Then it says so while staying focusable, unlike a disabled button
    expect(rematch().getAttribute("aria-disabled")).toBe("true");
    expect(rematch().disabled).toBe(false);
    expect(document.activeElement).toBe(rematch());
  });
});

describe("zooming while aiming", () => {
  it("brings the aimed area back into view", () => {
    // Given a square is aimed at on the fitted board
    render();
    act(() => bomb().click());
    tap(cell(1, 1));
    scrollIntoView.mockClear();

    // When the player zooms, which moves the square
    act(() => container.querySelector<HTMLButtonElement>(".arcade-zoom-button")?.click());

    // Then the preview scrolls back into view
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector(".board-bomb-preview"));
  });

  it("leaves the scroll position alone when nothing is aimed", () => {
    // Given no aimed square
    render();

    // When the player zooms
    act(() => container.querySelector<HTMLButtonElement>(".arcade-zoom-button")?.click());

    // Then nothing scrolls
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
