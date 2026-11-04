import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type InviteNotice, RoomWaitingPanel } from "./RoomWaitingPanel.js";

const renderPanel = (inviteNotice: InviteNotice | null, onShare?: (value: string) => void) =>
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
      onShare={onShare}
      onCancelRoom={() => undefined}
      onHome={() => undefined}
      cancelPending={false}
    />
  );

describe("RoomWaitingPanel invite actions", () => {
  it("keeps Copy as the main action where the browser cannot share", () => {
    // Given a browser with no share sheet
    // When the waiting room renders
    const html = renderPanel(null);

    // Then Copy leads, and no share action appears
    expect(html).toContain("Copy invite link");
    expect(html).not.toContain("Share invite link");
    expect(html).not.toContain("room-invite-row");
  });

  it("leads with Share and moves Copy beside the link where the browser can share", () => {
    // Given a browser with a share sheet
    // When the waiting room renders
    const html = renderPanel(null, () => undefined);

    // Then Share leads, and Copy sits in the link row
    expect(html).toContain("Share invite link");
    expect(html).toContain('class="room-invite-row"');
    expect(html).toContain('aria-label="Copy invite link"');
    expect(html).toContain(">Copy</button>");
  });

  it("calls it an invite code rather than a token", () => {
    // Given the waiting room
    // When it renders
    const text = renderPanel(null).replace(/<[^>]*>/g, " ");

    // Then the jargon is gone
    expect(text).toContain("Copy a code instead");
    expect(text).toContain("Invite code");
    expect(text).toContain("Copy invite code");
    expect(text).not.toMatch(/token/i);
  });
});

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
