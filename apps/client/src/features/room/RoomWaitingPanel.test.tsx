import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type InviteNotice, RoomWaitingPanel } from "./RoomWaitingPanel.js";

const renderPanel = (inviteNotice: InviteNotice) =>
  renderToStaticMarkup(
    <RoomWaitingPanel
      roomCode="ABCDE"
      connectionStatus="connected"
      session={{
        roomId: "room-1",
        roomCode: "ABCDE",
        inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
        playerId: "host-1",
        displayName: "Host",
        sessionToken: "session-1",
        players: [{ playerId: "host-1", displayName: "Host" }]
      }}
      inviteNotice={inviteNotice}
      error={null}
      onCopy={() => undefined}
      onCancelRoom={() => undefined}
      onHome={() => undefined}
      cancelPending={false}
    />
  );

describe("RoomWaitingPanel invite notice", () => {
  it("announces a failed copy as an error", () => {
    // Given the clipboard refused the invite link
    const notice = { message: "Copy failed. Copy it manually from the screen.", failed: true };

    // When the waiting room shows the notice
    const html = renderPanel(notice);

    // Then the notice uses the error styling and alert role
    expect(html).toContain(
      '<p class="arcade-flow-error" role="alert">Copy failed. Copy it manually from the screen.</p>'
    );
  });

  it("confirms a successful copy as a status", () => {
    // Given the clipboard accepted the invite link
    const notice = { message: "Invite link copied.", failed: false };

    // When the waiting room shows the notice
    const html = renderPanel(notice);

    // Then the notice uses the success styling and status role
    expect(html).toContain('<p class="room-waiting-notice" role="status">Invite link copied.</p>');
  });
});
