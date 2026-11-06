import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, harness, harnessUrl, layoutAt, page, touchMatch } from "./responsive-browser.mjs";

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
  const { touch, phone } = await touchMatch(
    { width: 844, height: 390 },
    { bombArmed: true, scoreDeficit: 4 }
  );

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
    [1024, 570, {}],
    [320, 568, { longNames: true }]
  ]) {
    // Given a finished match on a short window with a rematch waiting for the opponent
    await layoutAt(width, height, { ...fixture, finished: true, rematch: true });
    await page.evaluate(() => document.querySelector(".board-cell").focus());

    for (let row = 1; row < 20; row += 1) {
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
  assert.ok(height + 8 <= 172, `the block is ${height}px tall`);
});

test("a zoomed bomb preview fits above Fire bomb on a landscape phone", async () => {
  for (const [width, height] of [
    [844, 390],
    [667, 375],
    [568, 320]
  ]) {
    // Given a zoomed board with an armed bomb on a landscape phone
    const { touch, phone } = await touchMatch(
      { width, height },
      { bombArmed: true, scoreDeficit: 4 }
    );
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

test("an unclaimed mine stays inside its tile on the smallest tiles", async () => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1366, 650]
  ]) {
    // Given a finished 30x30 match that shows unclaimed mines
    await layoutAt(width, height, { boardSize: "giant", finished: true });

    // When the mine in the bottom row is measured
    const { mine, tile } = await page.evaluate(() => {
      const burst = document.querySelector(".mine-burst");
      const box = (element) => element.getBoundingClientRect();
      const { bottom, right, top, left } = box(burst);
      const cell = box(burst.closest(".board-cell"));
      return {
        mine: { bottom, right, top, left },
        tile: { bottom: cell.bottom, right: cell.right, top: cell.top, left: cell.left }
      };
    });

    // Then it does not leave the tile
    const label = `${width}x${height}: ${JSON.stringify({ mine, tile })}`;
    assert.ok(mine.bottom <= tile.bottom + 0.5 && mine.top >= tile.top - 0.5, label);
    assert.ok(mine.right <= tile.right + 0.5 && mine.left >= tile.left - 0.5, label);
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
  // Given a saved zoom setting and a match that mounts on a mouse window
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await desktop.addInitScript(() => localStorage.setItem("msf:board:zoomed", "on"));
  const mouseWindow = await desktop.newPage();
  await mouseWindow.goto(harnessUrl);
  await mouseWindow.waitForSelector(".board-cell");
  const mouse = await mouseWindow.evaluate(() => ({
    button: document.querySelector(".arcade-zoom-button") !== null,
    zoomed: document.querySelector(".arcade-board-viewport.is-zoomed") !== null
  }));
  await desktop.close();

  // When the same match opens on a phone
  const { touch, phone } = await touchMatch({ width: 390, height: 844 }, {});
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

test("zoom follows a change to touch and back while the match is open", async () => {
  // Given a match open with a mouse
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const live = await context.newPage();
  await live.goto(harnessUrl);
  await live.waitForSelector(".board-cell");
  const session = await context.newCDPSession(live);
  const hasZoom = () => live.locator(".arcade-zoom-button").count();
  const before = await hasZoom();

  // When the device switches to touch, and then back
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await live.waitForSelector(".arcade-zoom-button");
  const onTouch = await hasZoom();
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await live.waitForSelector(".arcade-zoom-button", { state: "detached" });
  const after = await hasZoom();
  await context.close();

  // Then the control appears only while touch is in use
  assert.deepEqual([before, onTouch, after], [0, 1, 0]);
});

test("the disabled Fire bomb is solid, so tiles do not show through it", async () => {
  // Given an armed bomb on a phone turned sideways, where the button sits over the tiles
  const { touch, phone } = await touchMatch(
    { width: 844, height: 390 },
    { bombArmed: true, bombReady: true }
  );

  // When the button is measured before aiming
  const style = await phone.evaluate(() => {
    const fire = getComputedStyle(document.querySelector('button[name="fire-bomb"]'));
    return { opacity: fire.opacity, background: fire.backgroundColor };
  });
  await touch.close();

  // Then nothing about it is see-through
  assert.equal(style.opacity, "1");
  assert.match(style.background, /^rgb\(/);
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
  const { touch, phone } = await touchMatch(
    { width: 667, height: 375 },
    { bombArmed: true, scoreDeficit: 4 }
  );
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

test("the last row of a 30x30 board scrolls clear of a pinned Fire bomb", async () => {
  // Given an aimed bomb on the biggest board on a sideways phone
  const { touch, phone } = await touchMatch(
    { width: 667, height: 375 },
    { bombArmed: true, bombReady: true, boardSize: "giant" }
  );
  await phone.locator(".board-cell.status-hidden").nth(20).tap({ force: true });
  await phone.locator('button[name="fire-bomb"]').waitFor();

  // When the player scrolls to the end of the board
  const positions = await phone.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const cells = document.querySelectorAll(".board-cell");
    return {
      lastRow: cells[cells.length - 1].getBoundingClientRect().bottom,
      fire: document.querySelector('button[name="fire-bomb"]').getBoundingClientRect().top
    };
  });
  await touch.close();

  // Then the last row ends above it
  assert.ok(positions.lastRow <= positions.fire, JSON.stringify(positions));
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
