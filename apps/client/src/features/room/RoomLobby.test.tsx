import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RoomLobby } from "./RoomLobby.js";

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
});
