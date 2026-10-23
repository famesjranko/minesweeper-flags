import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { HostDirectMatchPanel } from "./HostDirectMatchPanel.js";

it("announces a failed direct-link copy as an error", () => {
  // Given the clipboard refused the host's direct link
  const notice = { message: "Copy failed. Copy it manually from the screen.", failed: true };

  // When the direct-match waiting room shows the notice
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <HostDirectMatchPanel
        roomCode="ABCDE"
        connectionStatus="connected"
        hostSetup={null}
        inviteNotice={notice}
        error={null}
        onCopy={() => undefined}
      />
    </MemoryRouter>
  );

  // Then the notice uses the error styling and alert role
  expect(html).toContain(
    '<span class="error-text" role="alert">Copy failed. Copy it manually from the screen.</span>'
  );
});
