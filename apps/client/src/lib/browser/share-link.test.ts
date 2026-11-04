// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { canShareLinks, shareLink } from "./share-link.js";

const setShare = (share: unknown) =>
  Object.defineProperty(window.navigator, "share", { configurable: true, value: share });

afterEach(() => {
  setShare(undefined);
});

describe("share links", () => {
  it("reports no share sheet where the browser has none", () => {
    // Given a desktop browser or a plain-HTTP page
    setShare(undefined);

    // When the app checks
    const available = canShareLinks();

    // Then it keeps the Copy layout
    expect(available).toBe(false);
  });

  it("opens the share sheet with the link", async () => {
    // Given a phone with a share sheet
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);

    // When the player shares
    const result = await shareLink("Minesweeper Flags", "https://example.test/invite/abc");

    // Then the sheet receives the title and the link
    expect(canShareLinks()).toBe(true);
    expect(result).toBe("shared");
    expect(share).toHaveBeenCalledExactlyOnceWith({
      title: "Minesweeper Flags",
      url: "https://example.test/invite/abc"
    });
  });

  it("treats closing the sheet as the player's choice", async () => {
    // Given a player who closes the sheet
    setShare(vi.fn().mockRejectedValue(new DOMException("Closed", "AbortError")));

    // When the share settles
    const result = await shareLink("Title", "https://example.test");

    // Then no failure is reported
    expect(result).toBe("cancelled");
  });

  it("reports a real failure", async () => {
    // Given a browser that refuses to share
    setShare(vi.fn().mockRejectedValue(new DOMException("Refused", "NotAllowedError")));

    // When the share settles
    const result = await shareLink("Title", "https://example.test");

    // Then the caller can tell the player
    expect(result).toBe("failed");
  });
});
