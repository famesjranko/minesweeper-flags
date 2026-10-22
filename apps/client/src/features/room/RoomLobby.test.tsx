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
    expect(html).toContain("Create Room");
    expect(html).toContain("Join by Token");
    expect(html).toContain("Invite token");
    expect(html).not.toContain("Host Direct Match");
    expect(html).not.toContain("Join Direct Match");
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

    expect(html).toContain("Host Direct Match");
    expect(html).toContain("Join Direct Match");
    expect(html).toContain("Guests join from the host&#x27;s direct link");
    expect(html).not.toContain("Create Room");
    expect(html).not.toContain("Join by Token");
    expect(html).not.toContain("Invite token");
  });

  it("disables hosted room actions until the server is connected", () => {
    // Given a server lobby with valid create and join input while it reconnects
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomLobby
          connectionStatus="connecting"
          deploymentMode="server"
          error={null}
          initialInviteValue="AbCdEfGhIjKlMnOpQrStUw"
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
        />
      </MemoryRouter>
    );

    // When the server transport is not ready
    // Then both server actions use their existing disabled state
    expect(html).toContain('class="lobby-action-button lobby-create-button" disabled=""');
    expect(html).toContain('class="lobby-action-button lobby-join-button" disabled=""');
  });

  it("keeps initial P2P hosting available before a peer connects", () => {
    // Given a direct-match lobby before a peer exists
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomLobby
          connectionStatus="disconnected"
          deploymentMode="p2p"
          error={null}
          onCreateRoom={vi.fn()}
          onJoinRoom={vi.fn()}
        />
      </MemoryRouter>
    );

    // When the host has entered its default display name
    // Then direct-match hosting remains enabled
    expect(html).toContain('class="lobby-action-button lobby-create-button"');
    expect(html).not.toContain('class="lobby-action-button lobby-create-button" disabled=""');
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
