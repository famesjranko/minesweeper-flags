// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AppRouter } from "./AppRouter.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("gives visitors a route back to the lobby from an unknown URL", () => {
  // Given a visitor opens an unknown URL
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/not-a-page");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    // When the router displays that URL
    act(() => root.render(<AppRouter />));

    // Then the visitor sees a not-found message and a link back to the lobby
    expect(container.querySelector("h1")?.textContent).toBe("We couldn’t find that page.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/lobby");
  } finally {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", originalUrl);
  }
});
