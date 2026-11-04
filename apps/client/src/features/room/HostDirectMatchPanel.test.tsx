import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { P2PHostSetupState } from "../../p2p/setup/p2p-setup.types.js";
import { HostDirectMatchPanel } from "./HostDirectMatchPanel.js";

it("announces a failed direct-link copy as an error", () => {
  // Given the clipboard refused the host's direct link
  const notice = { message: "Copy failed. Copy it manually from the screen.", failed: true };

  // When the direct-match waiting room shows the notice
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <HostDirectMatchPanel
        roomCode="ABCDE"
        hostSetup={null}
        inviteNotice={notice}
        error={null}
        onCopy={() => undefined}
      />
    </MemoryRouter>
  );

  // Then the notice uses the error styling and alert role
  expect(html).toContain(
    '<p class="arcade-flow-error" role="alert">Copy failed. Copy it manually from the screen.</p>'
  );
});

describe("the direct-match waiting room", () => {
  const renderPanel = (hostSetup: Partial<P2PHostSetupState> | null) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <HostDirectMatchPanel
          roomCode="ABCDE"
          hostSetup={hostSetup as P2PHostSetupState | null}
          inviteNotice={null}
          error={null}
          onCopy={() => undefined}
        />
      </MemoryRouter>
    );

  it("uses the approved room wording and no setup jargon", () => {
    // Given a host waiting for a guest
    const html = renderPanel({
      stage: "waiting-for-guest",
      sessionState: "open",
      displayName: "Ana",
      joinUrl: "https://example.test/p2p/join/session-1"
    });

    // When the waiting room renders
    const text = html.replace(/<[^>]*>/g, " ");

    // Then it says what the host needs to know, and nothing about signaling
    expect(text).toContain("Your room is ready.");
    expect(text).toContain("Keep this tab open, because your browser hosts the match.");
    expect(text).toContain("Waiting for your friend…");
    expect(text).toContain("Ana");
    expect(text).toContain("https://example.test/p2p/join/session-1");
    expect(text).not.toMatch(/signaling|authority|webrtc/i);
  });

  it("does not call a link unavailable while it is still being created", () => {
    // Given a host whose link is not ready yet
    // When the waiting room renders
    const html = renderPanel({ stage: "creating-session", joinUrl: null });

    // Then it says the link is on its way
    expect(html).toContain("Creating your link…");
    expect(html).not.toContain("Unavailable");
  });

  it("gives the specific cause alone when setup fails for a known reason", () => {
    // Given setup failed because the signaling service could not be reached
    const cause = "Can’t reach the direct match service. Check your connection and try again.";

    // When the waiting room renders
    const html = renderPanel({ stage: "failed", error: cause, joinUrl: null });

    // Then only that message shows
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain(cause);
    expect(html).not.toContain("Direct match setup failed.");
  });

  it.each([
    ["failed setup", { stage: "failed" }, "Direct match setup failed."],
    ["a closed room", { stage: "closed" }, "This direct match closed."],
    ["an expired link", { sessionState: "expired" }, "This direct link expired"]
  ] as const)("explains %s as an error", (_name, setup, message) => {
    // Given a setup that can no longer finish
    // When the waiting room renders
    const html = renderPanel({ joinUrl: null, ...setup });

    // Then the host is told in an alert, and the page no longer claims the room is ready
    expect(html).toMatch(new RegExp(`role="alert">${message}`));
    expect(html).toContain("Room unavailable");
    expect(html).not.toContain("Room ABCDE");
    expect(html).not.toContain("Your room is ready.");
    expect(html).not.toContain("Creating your link");
  });
});
