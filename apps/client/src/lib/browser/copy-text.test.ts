// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copy-text.js";

const setClipboard = (clipboard: unknown) =>
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: clipboard });

const setExecCommand = (result: boolean | (() => boolean)) => {
  const execCommand = vi.fn(typeof result === "function" ? result : () => result);
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  return execCommand;
};

afterEach(() => {
  setClipboard(undefined);
  document.body.replaceChildren();
});

describe("copyText", () => {
  it("uses the clipboard API when the page is on HTTPS", async () => {
    // Given a browser with the clipboard API
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const execCommand = setExecCommand(false);

    // When the text is copied
    const copied = await copyText("https://example.test/invite/abc");

    // Then the API receives it and the older command stays unused
    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("https://example.test/invite/abc");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("copies through a selection on plain HTTP and restores focus", async () => {
    // Given a plain-HTTP page, which has no clipboard API, with focus on a button
    setClipboard(undefined);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    let selected = "";
    setExecCommand(() => {
      const field = document.activeElement as HTMLTextAreaElement;
      selected = field.value.slice(field.selectionStart, field.selectionEnd);
      return true;
    });

    // When the text is copied
    const copied = await copyText("http://192.168.1.2/invite/abc");

    // Then the whole text was selected and the page is left as it was
    expect(copied).toBe(true);
    expect(selected).toBe("http://192.168.1.2/invite/abc");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("falls back when the browser denies clipboard permission", async () => {
    // Given a clipboard API that rejects
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const execCommand = setExecCommand(true);

    // When the text is copied
    const copied = await copyText("value");

    // Then the older command still copies it
    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
  });

  it("reports failure when no method works", async () => {
    // Given no clipboard API and a refused selection command
    setClipboard(undefined);
    setExecCommand(false);

    // When the text is copied
    const copied = await copyText("value");

    // Then the caller learns it failed
    expect(copied).toBe(false);
  });
});
