// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { LobbyBoardHero } from "./LobbyBoardHero.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderedSeeds = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(".lobby-board-hero")].map(
    (hero) => `${hero.dataset.previewSize}:${hero.dataset.previewSeed}`
  );

const Heroes = () => (
  <>
    <LobbyBoardHero />
    <LobbyBoardHero size="compact" />
  </>
);

it("keeps each document preview board through rerenders and remounts", () => {
  // Given both hero sizes mounted for the first time in this document
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);
  act(() => root.render(<Heroes />));
  const firstSeeds = renderedSeeds(container);

  // When React rerenders them and then mounts them again
  act(() => root.render(<Heroes />));
  const rerenderSeeds = renderedSeeds(container);
  act(() => root.unmount());
  const remounted = createRoot(container);
  act(() => remounted.render(<Heroes />));
  const remountSeeds = renderedSeeds(container);

  // Then each cached board stays unchanged
  expect(rerenderSeeds).toEqual(firstSeeds);
  expect(remountSeeds).toEqual(firstSeeds);

  act(() => remounted.unmount());
  container.remove();
});

it("shows a separately generated compact board beside the complete hero", () => {
  // Given both responsive hero views in one document
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Heroes />));

  try {
    // When the rendered cells of each view are read
    const full = container.querySelector<HTMLElement>("[data-preview-size='full']")!;
    const compact = container.querySelector<HTMLElement>("[data-preview-size='compact']")!;

    // Then the full view is a 16×16 board and the compact view is its own 8×8 board
    expect(full.querySelectorAll(".lobby-board-hero-cell")).toHaveLength(256);
    expect(compact.querySelectorAll(".lobby-board-hero-cell")).toHaveLength(64);
    expect(compact.dataset.previewSeed).not.toBe(full.dataset.previewSeed);

    // And the compact board shows flags for both players
    expect(compact.querySelectorAll(".is-flag-blue")).toHaveLength(3);
    expect(compact.querySelectorAll(".is-flag-red")).toHaveLength(3);
  } finally {
    act(() => root.unmount());
  }
});
