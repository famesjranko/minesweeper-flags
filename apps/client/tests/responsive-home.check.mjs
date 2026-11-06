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

      // When the control is taken away
      const heights = await page.evaluate((tab) => {
        const panel = document.querySelector(`#${tab}-panel`);
        const content = [...panel.children];
        const measure = () =>
          Math.max(...content.map((child) => child.getBoundingClientRect().bottom)) -
          panel.getBoundingClientRect().top;
        const withControl = measure();
        panel.querySelector(".board-size-select").style.display = "none";
        return { withControl, without: measure() };
      }, tab);
      await page.goto(harnessUrl);

      // Then the panel is the same height, because the control shares its row
      assert.ok(
        Math.abs(heights.withControl - heights.without) < 1,
        `${width}x${height} ${tab}: ${heights.withControl} against ${heights.without}`
      );
    }
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
