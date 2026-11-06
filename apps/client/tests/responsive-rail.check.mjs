import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutAt, page } from "./responsive-browser.mjs";

// Every height here has room for the scores and the 480px board floor.
const LAPTOPS = [
  [1366, 650],
  [1280, 720],
  [1536, 730],
  [1366, 768]
];

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

test("every window with room keeps the whole match on one screen beside a rail", async () => {
  for (const [width, height] of [
    [1024, 768],
    [1280, 600],
    [1366, 650],
    [1440, 780],
    [1920, 935],
    [2560, 1300],
    [3440, 1300],
    [900, 900]
  ]) {
    for (const boardSize of ["large", "huge", "giant"]) {
      for (const solo of [false, true]) {
        // Given a match on a window wide and tall enough for the rail
        // When the match renders
        const layout = await layoutAt(width, height, { boardSize, solo });
        const label = `${width}x${height} ${boardSize}${solo ? " solo" : ""}`;
        const rail = await page.evaluate(() => {
          const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
          const side = box(".solo-race-panel") ?? box(".arcade-chat-region");
          const panel = document.querySelector(".solo-race-panel");
          return {
            pageHeight: document.documentElement.scrollHeight,
            sideLeft: side.left,
            actionsBottom: box(".match-action-slot").bottom,
            headerWidth: box(".arcade-header").width,
            clipped: panel ? panel.scrollHeight > panel.clientHeight + 1 : false
          };
        });

        // Then nothing scrolls
        assert.ok(rail.pageHeight <= height, `${label}: page is ${rail.pageHeight}px tall`);

        // And the rail sits beside the board and ends level with it
        assert.ok(rail.sideLeft >= layout.board.right, `${label}: rail overlaps the board`);
        assert.ok(
          Math.abs(rail.actionsBottom - layout.board.bottom) <= 1,
          `${label}: actions run past the board`
        );

        // And the header spans the board and the rail together
        assert.ok(
          rail.headerWidth > layout.board.width + 280,
          `${label}: header is ${rail.headerWidth}px`
        );

        // And the Solo panel shows everything it has
        assert.equal(rail.clipped, false, `${label}: the Solo panel clips its content`);
      }
    }
  }
});

test("a notice above a Solo match does not push the actions off the screen", async () => {
  for (const [width, height] of [
    [1280, 600],
    [1366, 650],
    [1920, 935]
  ]) {
    // Given a resumed Solo match with a notice above it
    // When the match renders
    await layoutAt(width, height, { boardSize: "large", solo: true, soloNotice: true });
    const screen = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      actions: document.querySelector(".match-action-slot").getBoundingClientRect().bottom
    }));

    // Then the page does not scroll, and the actions stay on screen
    assert.ok(screen.height <= height, `${width}x${height}: page is ${screen.height}px tall`);
    assert.ok(screen.actions <= height, `${width}x${height}: actions end at ${screen.actions}px`);
  }
});

test("squares stop growing at 36px on the biggest windows", async () => {
  for (const [boardSize, boardWidth] of [
    ["large", 776],
    ["giant", 1156]
  ]) {
    // Given a board on a 4K window with far more room than it needs
    // When the match renders
    const { board } = await layoutAt(3840, 2000, { boardSize });

    // Then the board stops at 36px squares
    assert.equal(board.width, boardWidth);
  }
});

test("near-square windows keep squares as large as the stacked layout gave", async () => {
  for (const [width, height, minimum] of [
    [900, 900, 15.5],
    [1024, 1080, 19.6],
    [1100, 1000, 21.5]
  ]) {
    // Given a 30x30 board on a window nearly as tall as it is wide
    // When the match renders
    const { cell } = await layoutAt(width, height, { boardSize: "giant" });

    // Then squares are no smaller than before the rail existed
    assert.ok(cell.width >= minimum, `${width}x${height}: squares are ${cell.width}px`);
  }
});

test("an upright monitor stacks the match with chat under the board", async () => {
  for (const [width, height] of [
    [1080, 1780],
    [1440, 2400]
  ]) {
    // Given a match on a monitor turned upright
    // When the match renders
    const { board, composer } = await layoutAt(width, height, { boardSize: "giant" });

    // Then the chat is under the board, and its input is on screen
    assert.ok(composer.y >= board.bottom, `${width}x${height}: chat starts at ${composer.y}px`);
    assert.ok(composer.bottom <= height, `${width}x${height}: input ends at ${composer.bottom}px`);
  }
});

test("the Solo panel only shows where the rail has room for it", async () => {
  for (const [width, height, shown] of [
    [390, 844, false],
    [768, 1024, false],
    [932, 430, false],
    [1080, 1780, false],
    [1366, 650, true]
  ]) {
    // Given a Solo match
    // When the match renders
    await layoutAt(width, height, { boardSize: "large", solo: true });
    const visible = await page.evaluate(
      () => getComputedStyle(document.querySelector(".solo-race-panel")).display !== "none"
    );

    // Then the panel shows only on the rail layout
    assert.equal(visible, shown, `${width}x${height}`);
  }
});

test("a window of exactly 3:4 keeps the rail usable", async () => {
  for (const [width, height] of [
    [900, 1200],
    [1080, 1440],
    [1200, 1600]
  ]) {
    for (const solo of [false, true]) {
      // Given a window exactly on the line between the rail and the upright stack
      // When the match renders
      await layoutAt(width, height, { boardSize: "giant", solo });
      const result = await page.evaluate((solo) => {
        const reachable = (selector) => {
          const target = document.querySelector(selector);
          const box = target.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return target.contains(hit);
        };
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          action: reachable(".match-action-slot .match-resign-action"),
          scores: reachable(".sidebar-player-panel .sidebar-score-pill"),
          side: reachable(solo ? ".solo-race-panel" : ".arcade-chat-region .chat-composer input")
        };
      }, solo);

      // Then nothing overflows, and nothing is hidden behind the board
      assert.deepEqual(
        result,
        { overflow: false, action: true, scores: true, side: true },
        `${width}x${height} solo=${solo}`
      );
    }
  }
});

test("the rail is 360px, and 300px with stacked scores on near-square windows", async () => {
  for (const [width, height, rail, stacked] of [
    [1366, 650, 360, false],
    [1920, 935, 360, false],
    [900, 900, 300, true],
    [1100, 1000, 300, true]
  ]) {
    // Given a match on a window with room for the rail
    // When the match renders
    const { scores } = await layoutAt(width, height, { boardSize: "giant" });
    const isStacked = await page.evaluate(() => {
      const [first, second] = document.querySelectorAll(".sidebar-player-panel");
      return second.getBoundingClientRect().top >= first.getBoundingClientRect().bottom;
    });

    // Then the rail has the chosen width, and the score cards the chosen shape
    assert.equal(scores.width, rail, `${width}x${height}`);
    assert.equal(isStacked, stacked, `${width}x${height}`);
  }
});

test("the rail starts at 580px tall and shorter windows keep the stack", async () => {
  for (const [height, beside] of [
    [579, false],
    [580, true]
  ]) {
    // Given a wide window either side of the line
    // When the match renders
    const { board, scores } = await layoutAt(1280, height, { boardSize: "large" });

    // Then the scores sit beside the board only with the rail
    assert.equal(scores.x >= board.right, beside, `${height}px: scores at ${scores.x}`);
    assert.equal(scores.bottom <= board.y, !beside, `${height}px: scores end at ${scores.bottom}`);
  }
});

test("the main action ends level with the board in every state", async () => {
  const STATES = [
    { name: "live" },
    { name: "armed", bombArmed: true, bombReady: true },
    { name: "finished", finished: true },
    { name: "rematch", finished: true, rematch: true }
  ];
  for (const [width, height] of [
    [1280, 600],
    [1366, 650],
    [1920, 935]
  ]) {
    for (const { name, ...fixture } of STATES) {
      // Given a match in one state on the rail layout
      // When the match renders
      const { board } = await layoutAt(width, height, { boardSize: "giant", ...fixture });
      const lowest = await page.evaluate(() =>
        Math.max(
          ...[...document.querySelectorAll(".match-action-main button")].map(
            (button) => button.getBoundingClientRect().bottom
          )
        )
      );

      // Then the lowest button lines up with the bottom of the board
      assert.ok(Math.abs(lowest - board.bottom) <= 1, `${width}x${height} ${name}: ${lowest}`);
    }
  }
});
