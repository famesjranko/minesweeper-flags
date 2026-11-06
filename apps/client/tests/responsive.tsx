import { nextPaint, renderFixture } from "./responsive-fixture.js";

export { renderFixture } from "./responsive-fixture.js";

// Run by the *.check.mjs files (make test-layout), or open /tests/responsive.html on the client dev
// server. These checks use real components without joining game rooms.
const box = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing layout element: ${selector}`);
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom
  };
};

export const readLayout = () => {
  const dialog = document.querySelector<HTMLDialogElement>(".arcade-chat-region");
  return {
    viewport: { width: innerWidth, height: innerHeight },
    board: box(".arcade-board-stage"),
    cell: box(".board-cell"),
    header: box(".arcade-header"),
    scores: box(".arcade-match-scores"),
    composer: dialog ? box(".arcade-chat-region .chat-composer") : null,
    chat: dialog?.open ? (dialog.matches(":modal") ? "sheet" : "sidebar") : "preview",
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth
  };
};

type Layout = ReturnType<typeof readLayout>;

export const checkStableSizing = async (before: Layout) => {
  await nextPaint();
  const after = readLayout();
  if (Math.abs(before.viewport.width - after.viewport.width) > 0.5) {
    throw new Error("Keep the viewport width unchanged for the stable-sizing check.");
  }
  if (before.chat !== after.chat) throw new Error("Chat layout changed at a fixed viewport width.");
  for (const name of ["board", "cell", "header"] as const) {
    for (const dimension of ["width", "height"] as const) {
      if (Math.abs(before[name][dimension] - after[name][dimension]) > 0.5) {
        throw new Error(`${name} ${dimension} changed at a fixed viewport width.`);
      }
    }
  }
  return { passed: true, before, after };
};

export const checkScrolling = async () => {
  // Given a rendered game at the top of its page
  window.scrollTo(0, 0);
  await nextPaint();
  const before = readLayout();

  // When the player scrolls to the bottom and returns to the board
  window.scrollTo(0, document.documentElement.scrollHeight);
  await checkStableSizing(before);
  window.scrollTo(0, 0);

  // Then the board and tile dimensions remain unchanged
  return checkStableSizing(before);
};

await renderFixture();
