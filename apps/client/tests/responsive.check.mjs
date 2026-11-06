import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

// Every height here has room for the scores and the 480px board floor.
const LAPTOPS = [
  [1366, 650],
  [1280, 720],
  [1536, 730],
  [1366, 768]
];

let server;
let browser;
let page;
let harnessUrl;

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
  harnessUrl = `${server.resolvedUrls.local[0]}tests/responsive.html`;
  await page.goto(harnessUrl);
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

test("a laptop window shows the scores and the last row together", async () => {
  for (const [width, height] of LAPTOPS) {
    // Given a match on a window shorter than the whole column
    // When the match renders
    const { scores, board } = await layoutAt(width, height);

    // Then the scores and the last row fit on one screen
    assert.ok(
      board.bottom - scores.y <= height,
      `${width}x${height}: ${board.bottom - scores.y}px`
    );

    // And the tiles stay large enough to aim at
    assert.ok(board.width >= 480, `${width}x${height}: board ${board.width}px`);
  }
});

test("a tall window grows the board until its squares reach 36px", async () => {
  // Given a match on a window with more than enough height
  // When the match renders
  const { board } = await layoutAt(1920, 1200);

  // Then the board is at its limit
  assert.equal(board.width, 624);
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
    const { scores, chat, composer } = await layoutAt(width, height);

    // Then the chat sits beside the board
    assert.equal(chat, "sidebar");

    // And the player can type at once
    assert.ok(composer.bottom <= height, `${width}x${height}: input ends at ${composer.bottom}px`);

    // And the history above the input has room to read
    assert.ok(composer.y - scores.y >= 200, `${width}x${height}: input starts at ${composer.y}px`);
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

// Desktop Chrome has no collapsing toolbar, so this catches a layout that reacts to scrolling but
// not dvh on a wide window. The height-change test above covers dvh below 900px.
test("scrolling keeps the board size", async () => {
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

test("the rematch action is on screen when a match ends on a short window", async () => {
  for (const [width, height] of [
    [844, 390],
    [667, 375],
    [1024, 600],
    [1366, 650],
    [390, 664],
    [375, 553],
    [360, 560],
    [600, 800]
  ]) {
    // Given a finished match on a window too short for the whole column
    await layoutAt(width, height, { finished: true });

    // When the player looks for the next action
    const bottom = await page.evaluate(
      () => document.querySelector(".match-primary-action").getBoundingClientRect().bottom
    );

    // Then it is on screen without scrolling
    assert.ok(bottom <= height, `${width}x${height}: action ends at ${bottom}px`);
  }
});

test("Fire bomb and the aimed square share a landscape phone's screen", async () => {
  // Given an armed bomb on a landscape phone with touch input
  const touch = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true
  });
  const phone = await touch.newPage();
  await phone.goto(page.url());
  await phone.evaluate(async () => {
    const checks = await import("/tests/responsive.tsx");
    await checks.renderFixture({ bombArmed: true, scoreDeficit: 4 });
  });

  // When the player taps a hidden square near the top of the board
  await phone.locator(".board-cell").nth(20).tap({ force: true });
  await phone.locator('button[name="fire-bomb"]').waitFor();
  const { fire, preview } = await phone.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    return { fire: box('button[name="fire-bomb"]'), preview: box(".board-bomb-preview") };
  });
  await touch.close();

  // Then Fire bomb is on screen
  assert.ok(fire.top >= 0 && fire.bottom <= 390, `Fire bomb spans ${fire.top}-${fire.bottom}px`);

  // And the aimed square is on screen above it
  assert.ok(preview.top >= 0 && preview.top < fire.top, `preview starts at ${preview.top}px`);
});

test("a long chat adds no blank scroll space to the page", async () => {
  for (const [width, height, pageHeight] of [
    [1366, 650, 807],
    [1920, 935, 935]
  ]) {
    // Given a match with a long chat from one sender
    await layoutAt(width, height, { longChat: true });

    // When the page height is measured
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    // Then the chat scrolls inside its own panel
    assert.ok(scrollHeight <= pageHeight, `${width}x${height}: page is ${scrollHeight}px`);
  }
});

test("a long chat gives the chat sheet itself nothing to scroll", async () => {
  // Given a phone match with a long chat from one sender
  await layoutAt(390, 844, { longChat: true });

  // When the player opens the chat sheet
  const { client, scroll } = await page.evaluate(async () => {
    document.querySelector(".arcade-chat-open, .arcade-chat-chip").click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const sheet = document.querySelector(".arcade-chat-region");
    const measured = { client: sheet.clientHeight, scroll: sheet.scrollHeight };
    sheet.close();
    return measured;
  });

  // Then only the message list scrolls, so the input stays put
  assert.ok(scroll <= client, `sheet scrolls ${scroll}px in ${client}px`);
});

test("copying chat text leaves out the hidden sender", async () => {
  // Given a side chat with follow-up messages
  await layoutAt(1280, 900, { longChat: true });

  // When the player selects the whole conversation
  const copied = await page.evaluate(() => {
    getSelection().selectAllChildren(document.querySelector(".arcade-chat-region [role=log]"));
    const text = getSelection().toString();
    getSelection().removeAllRanges();
    return text;
  });

  // Then the visible header appears, but no hidden sender and time
  assert.ok(copied.includes("First Mate"), "the visible sender is missing");
  assert.ok(!copied.includes("First Mate,"), `copied text includes: ${copied.slice(0, 120)}`);
});

test("a focused tile is not hidden under the pinned rematch action", async () => {
  for (const [width, height, fixture] of [
    [1024, 600, {}],
    [320, 568, { longNames: true }]
  ]) {
    // Given a finished match on a short window with a rematch waiting for the opponent
    await layoutAt(width, height, { ...fixture, finished: true, rematch: true });
    await page.evaluate(() => document.querySelector(".board-cell").focus());

    for (let row = 1; row < 16; row += 1) {
      // When the player presses the down arrow through the rows
      await page.keyboard.press("ArrowDown");
      const { action, tile } = await page.evaluate(() => ({
        action: document.querySelector(".match-rematch-action").getBoundingClientRect().top,
        tile: document.activeElement.getBoundingClientRect().bottom
      }));

      // Then each tile stays clear of the action
      const label = `${width}x${height} row ${row}: tile ends at ${tile}, action starts at ${action}`;
      assert.ok(tile <= action, label);
    }
  }
});

test("a long name in a wide font cannot make the pinned rematch block taller", async () => {
  // Given a finished match with long names on a narrow phone
  await layoutAt(320, 568, { longNames: true, finished: true, rematch: true });

  // When the status text is much wider than usual, as on a machine with different fonts
  const height = await page.evaluate(() => {
    document.querySelector(".match-rematch-action p").style.letterSpacing = "3px";
    document.querySelector(".match-result-line").style.letterSpacing = "3px";
    return document.querySelector(".match-action-slot").getBoundingClientRect().height;
  });

  // Then the block stays within the page's scroll padding
  assert.ok(height + 8 <= 168, `the block is ${height}px tall`);
});

test("a zoomed bomb preview fits above Fire bomb on a landscape phone", async () => {
  for (const [width, height] of [
    [844, 390],
    [667, 375],
    [568, 320]
  ]) {
    // Given a zoomed board with an armed bomb on a landscape phone
    const touch = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true
    });
    const phone = await touch.newPage();
    await phone.goto(page.url());
    await phone.evaluate(async () => {
      const checks = await import("/tests/responsive.tsx");
      await checks.renderFixture({ bombArmed: true, scoreDeficit: 4 });
    });
    await phone.getByRole("button", { name: /Expand board/ }).tap();

    // When the player aims at a square in the middle of the board
    await phone.locator(".board-cell").nth(102).tap({ force: true });
    await phone.locator('button[name="fire-bomb"]').waitFor();
    await phone.waitForTimeout(100);
    const { fire, preview } = await phone.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      return { fire: box('button[name="fire-bomb"]'), preview: box(".board-bomb-preview") };
    });
    await touch.close();

    // Then the whole preview is on screen above Fire bomb
    const label = `${width}x${height}: preview ${preview.top}-${preview.bottom}, Fire at ${fire.top}`;
    assert.ok(preview.top >= 0 && preview.bottom <= fire.top, label);
  }
});

test("tile marks keep their size limit on large tiles and stay large on phones", async () => {
  for (const [width, height, ratio, limit] of [
    [390, 844, 0.8, 18],
    [1920, 935, 0.58, 21],
    [1920, 1200, 0.56, 24]
  ]) {
    // Given a match with a flag and a number on the board
    await layoutAt(width, height, { scoreDeficit: 1 });

    // When the marks are measured
    const { tile, flag, number } = await page.evaluate(() => ({
      tile: document.querySelector(".board-cell").getBoundingClientRect().width,
      flag: document.querySelector(".board-cell svg").getBoundingClientRect().width,
      number: Number.parseFloat(getComputedStyle(document.querySelector(".cell-number")).fontSize)
    }));

    // Then the number has the chosen size for this tile
    assert.ok(number <= limit, `${width}x${height}: number is ${number}px on a ${tile}px tile`);
    assert.ok(number >= tile * ratio - 1, `${width}x${height}: number is ${number}px`);

    // And the flag stays close to the number
    assert.ok(Math.abs(flag - number) <= 2, `${width}x${height}: flag is ${flag}px`);
  }
});

test("zoom is offered on touch screens and not to a mouse", async () => {
  // Given a saved zoom setting and a match on a mouse window
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => localStorage.setItem("msf:board:zoomed", "on"));
  await harness(async (checks) => checks.renderFixture());
  const mouse = await page.evaluate(() => ({
    button: document.querySelector(".arcade-zoom-button") !== null,
    zoomed: document.querySelector(".arcade-board-viewport.is-zoomed") !== null
  }));
  await page.evaluate(() => localStorage.removeItem("msf:board:zoomed"));

  // When the same match opens on a phone
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  const phone = await touch.newPage();
  await phone.goto(page.url());
  await phone.evaluate(async () => {
    const checks = await import("/tests/responsive.tsx");
    await checks.renderFixture();
  });
  const zoom = await phone.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const button = box(".arcade-zoom-button");
    const resign = box(".match-resign-action");
    return {
      sameRow: Math.abs(button.bottom - resign.bottom) < 1,
      gap: button.left - resign.right
    };
  });
  await touch.close();

  // Then the mouse has no zoom control and is not stuck zoomed
  assert.deepEqual(mouse, { button: false, zoomed: false });

  // And the phone has the control beside Resign
  assert.ok(zoom.sameRow && zoom.gap >= 0, JSON.stringify(zoom));
});

test("normal play pins nothing over the board on a sideways phone", async () => {
  for (const [width, height] of [
    [568, 320],
    [667, 375],
    [844, 390],
    [932, 430]
  ]) {
    // Given a live match on a phone turned sideways
    // When the match renders at the top of the page
    await layoutAt(width, height);
    const overlap = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      return box(".arcade-board-stage").bottom - box(".match-action-slot").top;
    });

    // Then the actions sit below the board, not over it
    assert.ok(overlap <= 0, `${width}x${height}: actions overlap the board by ${overlap}px`);
  }
});

test("the last row scrolls clear of a pinned Fire bomb", async () => {
  // Given an aimed bomb on a sideways phone
  const touch = await browser.newContext({
    viewport: { width: 667, height: 375 },
    hasTouch: true,
    isMobile: true
  });
  const phone = await touch.newPage();
  await phone.goto(page.url());
  await phone.evaluate(async () => {
    const checks = await import("/tests/responsive.tsx");
    await checks.renderFixture({ bombArmed: true, scoreDeficit: 4 });
  });
  await phone.locator(".board-cell").nth(20).tap({ force: true });
  await phone.locator('button[name="fire-bomb"]').waitFor();

  // When the player scrolls to the end of the board
  const positions = await phone.evaluate(() => {
    const top = document.querySelector('button[name="fire-bomb"]').getBoundingClientRect();
    window.scrollTo(0, document.documentElement.scrollHeight);
    const cells = document.querySelectorAll(".board-cell");
    return {
      pinned: top.bottom <= innerHeight,
      lastRow: cells[cells.length - 1].getBoundingClientRect().bottom,
      fire: document.querySelector('button[name="fire-bomb"]').getBoundingClientRect().top
    };
  });
  await touch.close();

  // Then Fire bomb was on screen before scrolling
  assert.ok(positions.pinned, "Fire bomb was off screen");

  // And the last row ends above it
  assert.ok(positions.lastRow <= positions.fire, JSON.stringify(positions));
});

test("a score card label stays clear of the score in any font", async () => {
  for (const width of [320, 340, 350, 360, 374, 375, 390, 430]) {
    for (const widerBy of ["0px", "0.6px", "1.2px"]) {
      for (const fixture of [{}, { offline: true }]) {
        // Given a phone whose font sets the labels wider than the fonts here
        await layoutAt(width, 700, fixture);

        // When the cards render
        const overlaps = await page.evaluate((spacing) => {
          const labels = document.querySelectorAll(".sidebar-player-header span");
          for (const label of labels) label.style.letterSpacing = spacing;
          const measured = [...document.querySelectorAll(".sidebar-player-panel")].map((card) => {
            const parts = [...card.querySelector(".sidebar-player-header").children];
            const right = Math.max(...parts.map((part) => part.getBoundingClientRect().right));
            return right - card.querySelector(".sidebar-score-pill").getBoundingClientRect().left;
          });
          // React keeps these elements, so the spacing would carry into later tests.
          for (const label of labels) label.style.letterSpacing = "";
          return measured;
        }, widerBy);

        // Then every label ends before its score starts
        const label = `${width}px, ${widerBy} wider, ${JSON.stringify(fixture)}: ${overlaps}`;
        assert.ok(Math.max(...overlaps) <= 0, label);
      }
    }
  }
});

test("an offline player's card says Offline", async () => {
  for (const width of [320, 330, 390, 1366]) {
    // Given a match with an offline opponent
    // When the opponent's card renders
    await layoutAt(width, 800, { offline: true });
    const label = await page.evaluate(() => {
      const offline = document.querySelector(".sidebar-player-panel:not(.is-self) .is-offline");
      return { text: offline.textContent, height: offline.getBoundingClientRect().height };
    });

    // Then the label reads Offline
    assert.equal(label.text, "Offline", `${width}px`);

    // And from 330px, where every font tried here has room, the word stays on one line
    if (width >= 330) assert.equal(label.height, 14, `${width}px`);
  }
});

test("opening How to play leaves its control in place", async () => {
  for (const [width, height] of [
    [390, 844],
    [1280, 800]
  ]) {
    // Given the home page with How to play closed
    await page.setViewportSize({ width, height });
    await page.goto(new URL("/", page.url()).href);
    const summary = page.locator(".game-help summary");
    await summary.waitFor();
    const closed = await summary.boundingBox();

    // When the player opens it
    await summary.click();
    const open = await summary.boundingBox();

    // Then the control has not moved under the pointer
    assert.equal(open.y, closed.y, `${width}x${height}: moved down`);
    const closedRight = closed.x + closed.width;
    assert.ok(Math.abs(open.x + open.width - closedRight) <= 1, `${width}x${height}: moved across`);

    // And it sits at the right of the page, where it has always been
    assert.ok(closedRight > width * 0.75, `${width}x${height}: ends at ${closedRight}`);
  }
  await page.goto(harnessUrl);
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
