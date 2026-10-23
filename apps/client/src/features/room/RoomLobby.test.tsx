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
    expect(html).toContain("Invite token");
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
    expect(html).not.toContain("Invite token");
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
    expect(onCreateRoom).toHaveBeenCalledExactlyOnceWith("Captain Sweeper");
    expect(onJoinRoom).toHaveBeenCalledExactlyOnceWith("Captain Sweeper", "AbCdEfGhIjKlMnOpQrStUw");

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
