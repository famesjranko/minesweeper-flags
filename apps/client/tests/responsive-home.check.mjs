import assert from "node:assert/strict";
import { test } from "node:test";
import { harnessUrl, page } from "./responsive-browser.mjs";

test("the board size control adds no height to the home page", async () => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1366, 650]
  ]) {
    for (const tab of ["friend", "solo"]) {
      // Given the home page on one tab
      await page.setViewportSize({ width, height });
      await page.goto(new URL("/lobby", harnessUrl).href);
      await page.waitForSelector("#friend-panel .lobby-create-button");
      await page.click(`#${tab}-tab`);

      // When the control is measured beside its button, and then taken away
      const result = await page.evaluate((tab) => {
        const panel = document.querySelector(`#${tab}-panel`);
        const content = [...panel.children];
        const measure = () =>
          Math.max(...content.map((child) => child.getBoundingClientRect().bottom)) -
          panel.getBoundingClientRect().top;
        const control = panel.querySelector(".board-size-select");
        const beside = control.parentElement.lastElementChild.getBoundingClientRect();
        const select = control.getBoundingClientRect();
        const row = {
          sameRow: Math.abs(select.top - beside.top) < 1,
          gap: beside.left - select.right,
          right: beside.right,
          overflow: document.documentElement.scrollWidth > innerWidth
        };
        const withControl = measure();
        control.style.display = "none";
        return { row, withControl, without: measure() };
      }, tab);
      await page.goto(harnessUrl);
      const label = `${width}x${height} ${tab}`;

      // Then the panel is the same height, because the control shares its row
      assert.ok(
        Math.abs(result.withControl - result.without) < 1,
        `${label}: ${JSON.stringify(result)}`
      );

      // And the two controls sit side by side on the screen
      assert.equal(result.row.sameRow, true, label);
      assert.ok(result.row.gap >= 0, `${label}: the controls overlap by ${-result.row.gap}px`);
      assert.ok(result.row.right <= width, `${label}: the button ends at ${result.row.right}px`);
      assert.equal(result.row.overflow, false, `${label}: the page scrolls sideways`);
    }
  }
});

test("a saved Solo game offers Return and Start new without breaking the page", async () => {
  for (const width of [320, 390, 1366]) {
    // Given a live Solo game saved in this tab
    await page.setViewportSize({ width, height: 700 });
    await page.goto(new URL("/lobby", harnessUrl).href);
    await page.evaluate(() =>
      sessionStorage.setItem(
        "msf:solo:v1",
        JSON.stringify({
          version: 1,
          seed: 11,
          createdAt: 20,
          starter: "human",
          difficulty: "normal",
          boardSize: "large",
          actions: []
        })
      )
    );

    // When the home page opens on the Solo tab
    await page.reload();
    await page.click("#solo-tab");
    const home = await page.evaluate(() => {
      const links = [...document.querySelectorAll("#solo-panel .solo-entry-primary")];
      const select = document
        .querySelector("#solo-panel .board-size-select")
        .getBoundingClientRect();
      const startNew = links[1]?.getBoundingClientRect();
      return {
        links: links.map((link) => link.textContent),
        sameRow: Math.abs(select.top - startNew.top) < 1,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(harnessUrl);

    // Then Return has its own row, the size sits beside Start new, and nothing overflows
    assert.deepEqual(
      home,
      { links: ["Return to game", "Start new"], sameRow: true, overflow: false },
      `${width}px`
    );
  }
});

test("opening How to play leaves its control in place", async () => {
  for (const [width, height] of [
    [390, 844],
    [1280, 800]
  ]) {
    // Given the home page with How to play closed
    await page.setViewportSize({ width, height });
    await page.goto(new URL("/", harnessUrl).href);
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
