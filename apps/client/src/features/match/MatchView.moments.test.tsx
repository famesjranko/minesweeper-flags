// @vitest-environment jsdom

import type { ChatMessageDto, MatchStateDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchView } from "./MatchView.js";

vi.mock("../sound/sound-player.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSoundPlayer: () => ({ play: () => {} })
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMatch = (overrides: Partial<MatchStateDto> = {}): MatchStateDto => ({
  roomId: "room",
  phase: "live",
  board: { rows: 1, columns: 1, mineCount: 1, cells: [] },
  players: [
    {
      playerId: "me",
      displayName: "Ana",
      score: 25,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "them",
      displayName: "Bo",
      score: 10,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: "me",
  turnPhase: "awaiting_action",
  turnNumber: 5,
  winnerPlayerId: null,
  lastAction: null,
  ...overrides
});

const finished = (winnerPlayerId: string) =>
  createMatch({
    phase: "finished",
    currentTurnPlayerId: null,
    turnPhase: "ended",
    winnerPlayerId
  });

const message = (id: number): ChatMessageDto => ({
  messageId: `m${id}`,
  playerId: "them",
  displayName: "Bo",
  text: "Nice opening",
  sentAt: Date.now() + 60_000 + id
});

let container: HTMLDivElement;
let root: Root;
const showModal = vi.fn();

const onBackToLobby = vi.fn();

const render = (
  match: MatchStateDto,
  chatMessages: ChatMessageDto[] = [],
  connectionStatus: "connected" | "connecting" | "disconnected" = "connected",
  pending: { movePending?: boolean; onCellSelect?: () => void } = {}
) =>
  act(() =>
    root.render(
      <MatchView
        roomCode="ABCDE"
        currentPlayerId="me"
        match={match}
        bombArmed={false}
        connectionStatus={connectionStatus}
        movePending={pending.movePending ?? false}
        chatMessages={chatMessages}
        chatError={null}
        chatDraft=""
        chatPending={false}
        onToggleBomb={() => {}}
        onCellSelect={pending.onCellSelect ?? (() => {})}
        onChatDraftChange={() => {}}
        onSendChatMessage={() => {}}
        onResign={() => {}}
        onRequestRematch={() => {}}
        onCancelRematch={() => {}}
        onBackToLobby={onBackToLobby}
      />
    )
  );

const chip = () => container.querySelector<HTMLButtonElement>(".arcade-chat-chip");

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "close", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLElement.prototype, "showModal", {
    configurable: true,
    value: showModal
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {}
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  showModal.mockClear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "close");
  Reflect.deleteProperty(HTMLElement.prototype, "showModal");
});

describe("the win celebration", () => {
  it("bursts flags in the winner's colour when the player wins during play", () => {
    // Given a live match the player is about to win
    render(createMatch());
    expect(container.querySelector(".win-burst")).toBeNull();

    // When the winning snapshot arrives
    render(finished("me"));

    // Then the burst, the flag wave and the board highlight all run
    expect(container.querySelectorAll(".win-burst-flag").length).toBeGreaterThan(0);
    expect(container.querySelector(".win-burst")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".board-grid.celebrate-blue")).not.toBeNull();
    expect(container.querySelector(".arcade-board-viewport.is-celebrating")).not.toBeNull();
  });

  it("does not celebrate a loss", () => {
    // Given a live match the player is about to lose
    render(createMatch());

    // When the losing snapshot arrives
    render(finished("them"));

    // Then nothing bursts
    expect(container.querySelector(".win-burst")).toBeNull();
    expect(container.querySelector(".is-celebrating")).toBeNull();
  });

  it("does not replay a win when a finished match is reopened", () => {
    // Given a refresh on a match the player has already won
    // When the view mounts
    render(finished("me"));

    // Then the old win stays quiet
    expect(container.querySelector(".win-burst")).toBeNull();
  });

  it("celebrates the next win after a rematch from a reopened match", () => {
    // Given a reopened finished match followed by a rematch
    render(finished("me"));
    render(createMatch());

    // When the player wins the rematch
    render(finished("me"));

    // Then this win counts
    expect(container.querySelector(".win-burst")).not.toBeNull();
  });
});

describe("the score bump", () => {
  const score = () => container.querySelector(".sidebar-player-panel-blue .sidebar-score-pill");

  it("stays still for the score shown on arrival and bumps for a new point", () => {
    // Given a player's score on arrival
    render(createMatch());
    expect(score()?.querySelector(".is-bump")).toBeNull();

    // When they claim a mine
    const scored = createMatch();
    scored.players[0].score = 26;
    render(scored);

    // Then the new score bumps
    expect(score()?.querySelector("strong.is-bump")?.textContent).toBe("26");
  });
});

describe("the full chat's presence line", () => {
  const presence = () => container.querySelector("dialog .chat-inline-status")?.textContent;

  it("says the opponent is online", () => {
    // Given a connected opponent
    // When the match renders
    render(createMatch());

    // Then the full chat says so
    expect(presence()).toBe("Bo is online.");
  });

  it("says the opponent is offline", () => {
    // Given an opponent who has disconnected
    const match = createMatch();
    match.players[1].connected = false;

    // When the match renders
    render(match);

    // Then the full chat says so
    expect(presence()).toBe("Bo is offline.");
  });
});

describe("the way back to the lobby", () => {
  it("leaves without a page load, so the lobby can offer the way back in", () => {
    // Given a live friend match
    render(createMatch());
    onBackToLobby.mockClear();
    const link = container.querySelector<HTMLAnchorElement>(
      '.arcade-options-menu a[href="/lobby"]'
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    // When the player chooses Back to lobby
    act(() => {
      link?.dispatchEvent(click);
    });

    // Then the app handles it and the session survives
    expect(onBackToLobby).toHaveBeenCalledOnce();
    expect(click.defaultPrevented).toBe(true);
  });
});

describe("the header's connection label", () => {
  const label = () => container.querySelector(".arcade-connection");

  it("reports a lost connection while the opponent is online", () => {
    // Given a player whose own connection has dropped
    // When the match renders
    render(createMatch(), [], "disconnected");

    // Then the label says so
    expect(label()?.textContent).toBe("disconnected");
  });

  it("does not call a healthy host disconnected when only the guest has gone", () => {
    // Given a direct-match host whose link was the guest
    const match = createMatch();
    match.players[1].connected = false;

    // When the match renders
    render(match, [], "disconnected");

    // Then the strip explains it and the header does not contradict it
    expect(label()).toBeNull();
  });

  it("keeps reporting the player's own retry when the opponent is also offline", () => {
    // Given an opponent who has left, and a client retrying its own connection
    const match = createMatch();
    match.players[1].connected = false;

    // When the match renders
    render(match, [], "connecting");

    // Then the label still shows the retry
    expect(label()?.textContent).toBe("Connecting…");
  });

  it("keeps showing a good connection when the opponent is offline", () => {
    // Given a connected player whose opponent has dropped
    const match = createMatch();
    match.players[1].connected = false;

    // When the match renders
    render(match);

    // Then the player's own connection is still reported
    expect(label()?.textContent).toBe("connected");
  });
});

describe("a connection drop", () => {
  it("is explained by the strip alone, so the board does not move", () => {
    // Given a player in a live match
    render(createMatch());
    const rowsAboveBoard = container.querySelector(".arcade-match")?.children.length;

    // When their own connection drops and the client starts retrying
    render(createMatch(), [], "connecting");

    // Then the strip says so, and nothing is inserted above the board
    expect(container.querySelector(".arcade-turn-hint")?.textContent).toBe("Reconnecting…");
    expect(container.querySelector(".arcade-match")?.children.length).toBe(rowsAboveBoard);
  });
});

describe("the unread chat chip", () => {
  it("keeps chat available from the header before any unread message arrives", () => {
    // Given a quiet match with no unread messages
    render(createMatch());
    const openChat = container.querySelector<HTMLButtonElement>(".arcade-chat-open");

    // When the player opens chat from the header
    act(() => openChat?.click());

    // Then chat opens without waiting for an unread notification
    expect(openChat?.getAttribute("aria-label")).toBe("Open chat");
    expect(showModal).toHaveBeenCalledOnce();
    expect(chip()).toBeNull();
  });

  it("is absent until the opponent sends something", () => {
    // Given a quiet chat
    // When the match renders
    render(createMatch());

    // Then there is no chip
    expect(chip()).toBeNull();
  });

  it("counts new messages and opens the chat", () => {
    // Given a live match
    render(createMatch());

    // When the opponent sends a message
    render(createMatch(), [message(1)]);

    // Then the chip shows the count and names itself for screen readers
    expect(chip()?.textContent).toBe("Chat · 1");
    expect(chip()?.getAttribute("aria-label")).toBe("Open chat, 1 new message");

    // When the player opens it
    act(() => chip()?.click());

    // Then the chat opens and the chip goes away
    expect(showModal).toHaveBeenCalledOnce();
    expect(chip()).toBeNull();
  });

  it("gives focus a place to land when the chat closes after its chip has gone", () => {
    // Given a player who opened the chat from the chip, which then left the page
    render(createMatch());
    render(createMatch(), [message(1)]);
    act(() => chip()?.click());
    expect(document.activeElement).toBe(document.body);

    // When the chat closes
    act(() => {
      container.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });

    // Then focus moves to the control that reopens it
    expect(document.activeElement).toBe(container.querySelector(".chat-expand"));
  });

  it("rescues focus still sitting inside the chat when it closes", () => {
    // Given a real browser, where focus stays on the chat's own button during the close event
    render(createMatch());
    const dialog = container.querySelector("dialog");
    const closeButton = dialog?.querySelector<HTMLButtonElement>(".arcade-chat-close");
    dialog?.setAttribute("open", "");
    act(() => closeButton?.focus());
    expect(document.activeElement).toBe(closeButton);

    // When the chat closes
    act(() => {
      dialog?.dispatchEvent(new Event("close"));
    });

    // Then focus moves out before the browser can drop it to the body
    expect(document.activeElement).toBe(container.querySelector(".chat-expand"));
  });

  it("leaves focus alone when the browser restored it on close", () => {
    // Given focus already on a real control
    render(createMatch());
    const zoom = container.querySelector<HTMLButtonElement>(".arcade-zoom-button");
    act(() => zoom?.focus());

    // When the chat closes
    act(() => {
      container.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });

    // Then focus stays put
    expect(document.activeElement).toBe(zoom);
  });

  it("clears when the player opens the chat from the preview", () => {
    // Given one unread message
    render(createMatch());
    render(createMatch(), [message(1)]);

    // When the player uses Full chat under the board
    act(() => container.querySelector<HTMLButtonElement>(".chat-expand")?.click());

    // Then the message counts as seen
    expect(showModal).toHaveBeenCalledOnce();
    expect(chip()).toBeNull();
  });
});

describe("waiting for a move reply", () => {
  it("acknowledges a pending move, blocks another selection, and keeps keyboard focus", () => {
    // Given a focused square on the player's turn
    const match = createMatch({
      board: {
        rows: 1,
        columns: 1,
        mineCount: 1,
        cells: [
          [{ row: 0, column: 0, status: "hidden", adjacentMines: null, claimedByPlayerId: null }]
        ]
      }
    });
    const select = vi.fn();
    render(match, [], "connected", { onCellSelect: select });
    const cell = container.querySelector<HTMLButtonElement>("button[data-cell]")!;
    cell.focus();

    // When a move is pending and the player attempts another selection
    render(match, [], "connected", { movePending: true, onCellSelect: select });
    act(() => cell.click());

    // Then the board acknowledges the move, preserves focus, and sends nothing else
    expect(container.querySelector(".arcade-turn-hint")?.textContent).toBe("Sending move…");
    expect(document.activeElement).toBe(cell);
    expect(cell.getAttribute("aria-disabled")).toBe("true");
    expect(select).not.toHaveBeenCalled();

    // And after the reply, the same focused square can be selected again
    render(match, [], "connected", { onCellSelect: select });
    expect(container.querySelector(".arcade-turn-hint")?.textContent).not.toContain("Sending");
    expect(document.activeElement).toBe(cell);
    act(() => cell.click());
    expect(select).toHaveBeenCalledOnce();
  });

  it.each(["connecting", "disconnected"] as const)(
    "clears stale self presence while %s",
    (status) => {
      // Given a snapshot received while both players were online
      const match = createMatch();
      render(match);

      // When the local link goes down without a replacement snapshot
      render(match, [], status);

      // Then the local presence dot no longer claims the player is connected
      const presence = container.querySelector(".is-self .arcade-player-presence");
      expect(presence?.classList.contains("is-online")).toBe(false);
      expect(presence?.getAttribute("aria-label")).toBe("Disconnected");
      expect(match.players[0].connected).toBe(true);

      // And the restored link shows connected presence again
      render(match);
      expect(container.querySelector(".is-self .arcade-player-presence.is-online")).not.toBeNull();
    }
  );
});
