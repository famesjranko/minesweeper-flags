import { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

// Imported by each *.check.mjs file, which then runs against its own Chrome and client dev server.
let server;
export let browser;
export let page;
export let harnessUrl;

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

export const harness = (call, argument) =>
  page.evaluate(
    async ([source, value]) => {
      const checks = await import("/tests/responsive.tsx");
      return new Function("checks", "value", `return (${source})(checks, value)`)(checks, value);
    },
    [call.toString(), argument]
  );

export const layoutAt = async (width, height, options = {}) => {
  await page.setViewportSize({ width, height });
  return harness(async (checks, fixture) => {
    window.scrollTo(0, 0);
    await checks.renderFixture(fixture);
    return checks.readLayout();
  }, options);
};

/** A match in its own touch browser context, because touch cannot be switched on in `page`. */
export const touchMatch = async (viewport, fixture = {}) => {
  const touch = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const phone = await touch.newPage();
  await phone.goto(harnessUrl);
  await phone.evaluate(async (options) => {
    const checks = await import("/tests/responsive.tsx");
    await checks.renderFixture(options);
  }, fixture);
  return { touch, phone };
};
