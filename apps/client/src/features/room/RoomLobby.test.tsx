// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomLobby } from "./RoomLobby.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RoomLobby", () => {
  it("keeps the token create and join actions in server mode", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomLobby
          connectionStatus="connected"
          deploymentMode="server"
          error={null}
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(html).toContain("Create a Match");
    expect(html).toContain("Create room");
    expect(html).toContain("Have an invite?");
    expect(html).toContain("Invite link or code");
    expect(html).not.toContain("Host direct match");
    expect(html).not.toContain("Join direct match");
  });

  it("shows only direct match entry actions in p2p mode", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomLobby
          connectionStatus="connected"
          deploymentMode="p2p"
          error={null}
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(html).toContain("Host direct match");
    expect(html).toContain("Join direct match");
    expect(html).toContain("Guests join from the host&#x27;s direct link");
    expect(html).not.toContain("Create room");
    expect(html).not.toContain("Have an invite?");
    expect(html).not.toContain("Invite code");
  });

  it("offers Solo in plain words when the server cannot be reached", () => {
    // Given a lobby whose server has stayed unreachable
    // When it renders
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomLobby
          connectionStatus="connecting"
          deploymentMode="server"
          error={null}
          serverUnreachable
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
        />
      </MemoryRouter>
    );

    // Then the player learns why and how to play now
    expect(html).toContain("Can’t reach the game server.");
    expect(html).toContain("We’ll keep trying. You can still play the bot right now.");
    expect(html).toContain('<a href="/">Play Solo instead</a>');
  });

  it("shows no server notice while connecting normally", () => {
    // Given a lobby that is still within its normal connection time
    // When it renders
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomLobby
          connectionStatus="connecting"
          deploymentMode="server"
          error={null}
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
        />
      </MemoryRouter>
    );

    // Then no warning appears
    expect(html).not.toContain("Can’t reach the game server.");
  });

  describe("pressing Enter in the display name", () => {
    const pressEnter = (inviteValue: string) => {
      const onCreateRoom = vi.fn();
      const onJoinRoom = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <MemoryRouter>
            <RoomLobby
              connectionStatus="connected"
              deploymentMode="server"
              error={null}
              initialInviteValue={inviteValue}
              onCreateRoom={onCreateRoom}
              onJoinRoom={onJoinRoom}
            />
          </MemoryRouter>
        );
      });
      act(() => {
        container
          .querySelector(".lobby-identity-card input")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      act(() => root.unmount());
      container.remove();
      return { onCreateRoom, onJoinRoom };
    };

    it("creates a room when there is no invite code", () => {
      // Given a lobby with no invite code
      // When the player presses Enter in the name field
      const { onCreateRoom, onJoinRoom } = pressEnter("");

      // Then a room is created
      expect(onCreateRoom).toHaveBeenCalledExactlyOnceWith("Captain Sweeper");
      expect(onJoinRoom).not.toHaveBeenCalled();
    });

    it("does nothing when the invite code is not valid", () => {
      // Given a lobby holding a partial invite code
      // When the player presses Enter in the name field
      const { onCreateRoom, onJoinRoom } = pressEnter("AbCd");

      // Then no room is created by accident, and nothing is joined
      expect(onCreateRoom).not.toHaveBeenCalled();
      expect(onJoinRoom).not.toHaveBeenCalled();
    });

    it("joins when a valid invite code is present", () => {
      // Given a lobby holding a valid invite code
      // When the player presses Enter in the name field
      const { onCreateRoom, onJoinRoom } = pressEnter("AbCdEfGhIjKlMnOpQrStUw");

      // Then the player joins that room
      expect(onJoinRoom).toHaveBeenCalledExactlyOnceWith("First Mate", "AbCdEfGhIjKlMnOpQrStUw");
      expect(onCreateRoom).not.toHaveBeenCalled();
    });
  });

  describe("the invite field", () => {
    const inviteToken = "AbCdEfGhIjKlMnOpQrStUw";
    let root: ReturnType<typeof createRoot>;

    afterEach(() => act(() => root.unmount()));

    const renderField = () => {
      const onJoinRoom = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root.render(
          <MemoryRouter>
            <RoomLobby
              connectionStatus="connected"
              deploymentMode="server"
              error={null}
              onCreateRoom={vi.fn()}
              onJoinRoom={onJoinRoom}
            />
          </MemoryRouter>
        );
      });
      const input = container.querySelector<HTMLInputElement>(".invite-token-input")!;
      return {
        onJoinRoom,
        input,
        joinButton: () => container.querySelector<HTMLButtonElement>(".lobby-join-button")!,
        problem: () => container.querySelector(".lobby-invite-problem")?.textContent ?? null,
        enter: (value: string) =>
          act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
              input,
              value
            );
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }),
        leave: () =>
          act(() => {
            input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
          }),
        pressEnter: () =>
          act(() => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          })
      };
    };

    const EXPLANATION = "That isn’t an invite code. Paste the link your friend sent.";

    it("joins with the code inside a pasted link", () => {
      // Given a lobby where the player has pasted a friend's link
      const { enter, joinButton, onJoinRoom } = renderField();
      enter(`https://example.com/invite/${inviteToken}`);

      // When the player presses Join
      act(() => joinButton().click());

      // Then the player joins as a guest with the code from the link
      expect(onJoinRoom).toHaveBeenCalledExactlyOnceWith("First Mate", inviteToken);
    });

    it("does not limit the length, because a browser would cut a pasted link", () => {
      // Given the invite field
      // When it renders
      const { input } = renderField();

      // Then it sets no length limit
      expect(input.getAttribute("maxlength")).toBeNull();
    });

    it("explains a room code when the player leaves the field", () => {
      // Given a player who has entered the room code
      const { enter, leave, problem, joinButton } = renderField();
      enter("ABCDE");

      // When the player leaves the field
      leave();

      // Then it says why, and Join stays unavailable
      expect(problem()).toBe(EXPLANATION);
      expect(joinButton().disabled).toBe(true);
    });

    it("explains an invalid entry when the player presses Enter in the field", () => {
      // Given a player who has entered the room code
      const { enter, pressEnter, problem } = renderField();
      enter("ABCDE");

      // When the player presses Enter
      pressEnter();

      // Then it says why
      expect(problem()).toBe(EXPLANATION);
    });

    it("says nothing while the player is still typing", () => {
      // Given an empty field
      const { enter, problem } = renderField();

      // When the player types part of a code
      enter("AbCd");

      // Then there is no complaint yet
      expect(problem()).toBeNull();
    });

    it("drops the explanation when the player edits the entry", () => {
      // Given an explanation on screen
      const { enter, leave, problem } = renderField();
      enter("ABCDE");
      leave();

      // When the player edits the entry
      enter("ABCD");

      // Then the explanation is gone until they finish
      expect(problem()).toBeNull();
    });

    it("has nothing to explain for a valid link", () => {
      // Given a player who has pasted a valid link
      const { enter, leave, problem } = renderField();
      enter(`https://example.com/invite/${inviteToken}`);

      // When the player leaves the field
      leave();

      // Then there is no complaint
      expect(problem()).toBeNull();
    });
  });

  describe("the default display name", () => {
    const setup = () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <MemoryRouter>
            <RoomLobby
              connectionStatus="connected"
              deploymentMode="server"
              error={null}
              onCreateRoom={vi.fn()}
              onJoinRoom={vi.fn()}
            />
          </MemoryRouter>
        );
      });
      const typeInto = (selector: string, value: string) =>
        act(() => {
          const field = container.querySelector<HTMLInputElement>(selector)!;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(field, value);
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
      return {
        typeInto,
        name: () => container.querySelector<HTMLInputElement>(".lobby-identity-card input")?.value,
        dispose: () => {
          act(() => root.unmount());
          container.remove();
        }
      };
    };

    it("is the host's name until an invite code makes the player a guest", () => {
      // Given a fresh lobby showing the host's default
      const lobby = setup();
      expect(lobby.name()).toBe("Captain Sweeper");

      // When the player enters a valid invite code
      lobby.typeInto(".invite-token-input", "AbCdEfGhIjKlMnOpQrStUw");

      // Then the field shows the guest's default, which differs from the host's
      expect(lobby.name()).toBe("First Mate");
      lobby.dispose();
    });

    it("never replaces a name the player typed", () => {
      // Given a player who chose a name
      const lobby = setup();
      lobby.typeInto(".lobby-identity-card input", "Ana");

      // When they enter a valid invite code
      lobby.typeInto(".invite-token-input", "AbCdEfGhIjKlMnOpQrStUw");

      // Then their name stays
      expect(lobby.name()).toBe("Ana");
      lobby.dispose();
    });
  });

  it("gates server actions through connection loss without blocking initial P2P hosting", () => {
    // Given valid server lobby input and action callbacks
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCreateRoom = vi.fn();
    const onJoinRoom = vi.fn();
    const renderLobby = (connectionStatus: "disconnected" | "connecting" | "connected") => {
      root.render(
        <MemoryRouter>
          <RoomLobby
            connectionStatus={connectionStatus}
            deploymentMode="server"
            error={null}
            initialInviteValue="AbCdEfGhIjKlMnOpQrStUw"
            onCreateRoom={onCreateRoom}
            onJoinRoom={onJoinRoom}
          />
        </MemoryRouter>
      );
    };
    const submitActions = () => {
      container
        .querySelector<HTMLFormElement>("form.is-create")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      container
        .querySelector<HTMLFormElement>("form.is-join")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };

    // When the connection starts disconnected, retries, becomes ready, then is lost
    act(() => {
      renderLobby("disconnected");
    });
    expect(container.querySelector<HTMLButtonElement>(".lobby-create-button")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".lobby-join-button")?.disabled).toBe(true);
    act(submitActions);

    act(() => {
      renderLobby("connecting");
    });
    expect(container.querySelector<HTMLButtonElement>(".lobby-create-button")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".lobby-join-button")?.disabled).toBe(true);
    act(submitActions);

    act(() => {
      renderLobby("connected");
    });
    expect(container.querySelector<HTMLButtonElement>(".lobby-create-button")?.disabled).toBe(
      false
    );
    expect(container.querySelector<HTMLButtonElement>(".lobby-join-button")?.disabled).toBe(false);
    act(submitActions);

    act(() => {
      renderLobby("disconnected");
    });
    expect(container.querySelector<HTMLButtonElement>(".lobby-create-button")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".lobby-join-button")?.disabled).toBe(true);
    act(submitActions);

    // Then only the connected submissions reach their callbacks
    expect(onCreateRoom).toHaveBeenCalledExactlyOnceWith("First Mate");
    expect(onJoinRoom).toHaveBeenCalledExactlyOnceWith("First Mate", "AbCdEfGhIjKlMnOpQrStUw");

    act(() => {
      root.unmount();
    });
    const p2pContainer = document.createElement("div");
    document.body.appendChild(p2pContainer);
    const p2pRoot = createRoot(p2pContainer);
    const onP2PCreateRoom = vi.fn();

    act(() => {
      p2pRoot.render(
        <MemoryRouter>
          <RoomLobby
            connectionStatus="disconnected"
            deploymentMode="p2p"
            error={null}
            onCreateRoom={onP2PCreateRoom}
            onJoinRoom={vi.fn()}
          />
        </MemoryRouter>
      );
    });
    act(() => {
      p2pContainer
        .querySelector<HTMLFormElement>("form.is-create")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // And initial P2P hosting remains available before any peer connects
    expect(p2pContainer.querySelector<HTMLButtonElement>(".lobby-create-button")?.disabled).toBe(
      false
    );
    expect(onP2PCreateRoom).toHaveBeenCalledExactlyOnceWith("Captain Sweeper");
    act(() => {
      p2pRoot.unmount();
    });
  });

  it("cancels the refresh indicator timer when the lobby unmounts", () => {
    // Given a server lobby where the slot refresh button was pressed
    vi.useFakeTimers();
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <MemoryRouter>
            <RoomLobby
              connectionStatus="connected"
              deploymentMode="server"
              error={null}
              slotAvailability={{ activeRooms: 1, maxRooms: 5 }}
              onRefreshSlots={vi.fn()}
              onCreateRoom={vi.fn()}
              onJoinRoom={vi.fn()}
            />
          </MemoryRouter>
        );
      });
      act(() => {
        container.querySelector<HTMLButtonElement>(".lobby-slot-refresh")?.click();
      });
      expect(container.querySelector(".is-refreshing")).not.toBeNull();
      expect(vi.getTimerCount()).toBe(1);

      // When the lobby unmounts before the timer elapses
      act(() => {
        root.unmount();
      });

      // Then no refresh timer is left pending
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for a new room count when the refresh button is pressed", () => {
    // Given a server lobby showing the room count
    const onRefreshSlots = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <RoomLobby
            connectionStatus="connected"
            deploymentMode="server"
            error={null}
            slotAvailability={{ activeRooms: 1, maxRooms: 5 }}
            onRefreshSlots={onRefreshSlots}
            onCreateRoom={vi.fn()}
            onJoinRoom={vi.fn()}
          />
        </MemoryRouter>
      );
    });

    // When the refresh button is pressed
    act(() => {
      container.querySelector<HTMLButtonElement>(".lobby-slot-refresh")?.click();
    });

    // Then a new count is requested
    expect(onRefreshSlots).toHaveBeenCalledOnce();
    act(() => {
      root.unmount();
    });
  });

  it("stops the refresh indicator after a moment", () => {
    // Given a server lobby where the slot refresh button was pressed
    vi.useFakeTimers();
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <MemoryRouter>
            <RoomLobby
              connectionStatus="connected"
              deploymentMode="server"
              error={null}
              slotAvailability={{ activeRooms: 1, maxRooms: 5 }}
              onRefreshSlots={vi.fn()}
              onCreateRoom={vi.fn()}
              onJoinRoom={vi.fn()}
            />
          </MemoryRouter>
        );
      });
      act(() => {
        container.querySelector<HTMLButtonElement>(".lobby-slot-refresh")?.click();
      });
      expect(container.querySelector(".is-refreshing")).not.toBeNull();

      // When the indicator's time passes
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // Then the button is at rest again
      expect(container.querySelector(".is-refreshing")).toBeNull();
      act(() => {
        root.unmount();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a single refresh timer when the refresh button is pressed twice", () => {
    // Given a server lobby mounted under fake timers
    vi.useFakeTimers();
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          <MemoryRouter>
            <RoomLobby
              connectionStatus="connected"
              deploymentMode="server"
              error={null}
              slotAvailability={{ activeRooms: 1, maxRooms: 5 }}
              onRefreshSlots={vi.fn()}
              onCreateRoom={vi.fn()}
              onJoinRoom={vi.fn()}
            />
          </MemoryRouter>
        );
      });

      // When the slot refresh button is pressed twice before the timer elapses
      act(() => {
        container.querySelector<HTMLButtonElement>(".lobby-slot-refresh")?.click();
      });
      act(() => {
        container.querySelector<HTMLButtonElement>(".lobby-slot-refresh")?.click();
      });

      // Then only one refresh timer is pending
      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        root.unmount();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
