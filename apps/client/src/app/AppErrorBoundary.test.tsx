// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Broken = (): never => {
  throw new Error("render failed");
};

afterEach(() => {
  vi.restoreAllMocks();
});

const render = (child: React.ReactNode) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<AppErrorBoundary>{child}</AppErrorBoundary>));
  return { container, unmount: () => act(() => root.unmount()) };
};

it("replaces a crashed page with a way back into the game", () => {
  // Given a child that fails to render
  vi.spyOn(console, "error").mockImplementation(() => {});

  // When the app renders it
  const { container, unmount } = render(<Broken />);

  // Then the player sees an explanation and both ways out
  expect(container.querySelector("h1")?.textContent).toBe("The game hit a problem.");
  expect(container.querySelector("button")?.textContent).toBe("Reload");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
  unmount();
});

it("renders the app unchanged when nothing fails", () => {
  // Given a healthy child
  // When the app renders it
  const { container, unmount } = render(<p>Board</p>);

  // Then only the child appears
  expect(container.innerHTML).toBe("<p>Board</p>");
  unmount();
});
