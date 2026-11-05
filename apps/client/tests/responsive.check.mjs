import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

// Every height here has room for the turn band and the 480px board floor. Shorter windows rely on
// the sticky band, which has its own test.
const LAPTOPS = [
  [1366, 650],
  [1280, 720],
  [1536, 730],
  [1366, 768]
];

let server;
let browser;
let page;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "error",
    server: { host: "127.0.0.1", hmr: false }
  });
  await server.listen();
  browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" })
  });
  page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}tests/responsive.html`);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const harness = (call, argument) =>
  page.evaluate(
    async ([source, value]) => {
      const checks = await import("/tests/responsive.tsx");
      return new Function("checks", "value", `return (${source})(checks, value)`)(checks, value);
    },
    [call.toString(), argument]
  );

const layoutAt = async (width, height, options = {}) => {
  await page.setViewportSize({ width, height });
  return harness(async (checks, fixture) => {
    window.scrollTo(0, 0);
    await checks.renderFixture(fixture);
    return checks.readLayout();
  }, options);
};

test("a laptop window shows the turn band and the last row together", async () => {
  for (const [width, height] of LAPTOPS) {
    // Given a match on a window shorter than the whole column
    // When the match renders
    const { band, board } = await layoutAt(width, height);

    // Then the band and the last row fit on one screen
    assert.ok(board.bottom - band.y <= height, `${width}x${height}: ${board.bottom - band.y}px`);

    // And the tiles stay large enough to aim at
    assert.ok(board.width >= 480, `${width}x${height}: board ${board.width}px`);
  }
});

test("a tall window grows the board to its 720px limit", async () => {
  // Given a match on a window with more than enough height
  // When the match renders
  const { board } = await layoutAt(1920, 1200);

  // Then the board is at its limit
  assert.equal(board.width, 720);
});

test("a desktop-sized window fits the whole board once there is room", async () => {
  // Given a match on an ordinary 1080p browser window
  // When the match renders
  const { board } = await layoutAt(1920, 950);

  // Then the last row is on screen without scrolling
  assert.ok(board.bottom <= 950, `board ends at ${board.bottom}px`);
});

test("the side chat input is on screen without scrolling", async () => {
  for (const [width, height] of LAPTOPS) {
    // Given a match wide enough for the side chat
    // When the match renders
    const { band, chat, composer } = await layoutAt(width, height);

    // Then the chat sits beside the board
    assert.equal(chat, "sidebar");

    // And the player can type at once
    assert.ok(composer.bottom <= height, `${width}x${height}: input ends at ${composer.bottom}px`);

    // And the history above the input has room to read
    assert.ok(composer.y - band.y >= 200, `${width}x${height}: input starts at ${composer.y}px`);
  }
});

test("the turn band stays on screen after scrolling to the last row", async () => {
  for (const [width, height] of [
    [844, 390],
    [1024, 600],
    [1366, 650]
  ]) {
    // Given a match on a window too short for the whole column
    await layoutAt(width, height);

    // When the player scrolls to the bottom
    const band = await harness(async (checks) => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return checks.readLayout().band;
    });

    // Then the band is still visible
    assert.ok(band.y >= 0 && band.bottom <= height, `${width}x${height}: band at ${band.y}px`);
  }
});

test("a phone or tablet keeps one board size as the toolbar changes the height", async () => {
  for (const [width, tall, short] of [
    [390, 844, 760],
    [800, 1150, 600]
  ]) {
    // Given a match on a width below the side chat
    const before = await layoutAt(width, tall);

    // When the browser toolbar changes the height
    await page.setViewportSize({ width, height: short });

    // Then the board, tiles and header keep their sizes
    await harness((checks, previous) => checks.checkStableSizing(previous), before);
  }
});

test("scrolling never resizes the board", async () => {
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [1366, 650]
  ]) {
    // Given a match at the top of its page
    await layoutAt(width, height);

    // When the player scrolls down and back
    // Then the board, tiles and header keep their sizes
    await harness((checks) => checks.checkScrolling());
  }
});

test("no width scrolls the page sideways", async () => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [899, 700],
    [900, 700],
    [1920, 1080]
  ]) {
    // Given a match with the longest names
    // When the match renders
    const { horizontalOverflow } = await layoutAt(width, height, { longNames: true });

    // Then the page fits the window's width
    assert.equal(horizontalOverflow, false, `${width}x${height}`);
  }
});
