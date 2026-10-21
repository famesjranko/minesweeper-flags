import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserSoloStorage,
  SOLO_STORAGE_KEY,
  SOLO_STORAGE_MAX_ACTIONS,
  SOLO_STORAGE_MAX_BYTES
} from "./solo-storage.js";

const record = {
  version: 1 as const,
  seed: 4,
  createdAt: 7,
  starter: "human" as const,
  actions: []
};

afterEach(() => vi.unstubAllGlobals());

describe("browser solo storage", () => {
  it("rejects corrupt and bounded records as one failed restore", () => {
    // Given a browser record with invalid JSON, a control byte, or too many actions.
    const values = [
      "{",
      `${JSON.stringify(record)}\u0000`,
      JSON.stringify({
        ...record,
        actions: Array.from({ length: SOLO_STORAGE_MAX_ACTIONS + 1 }, () => ({
          type: "select",
          playerId: "solo-human",
          row: 0,
          column: 0
        }))
      })
    ];
    for (const raw of values) {
      const removeItem = vi.fn();
      vi.stubGlobal("window", {
        sessionStorage: { getItem: () => raw, removeItem, setItem: vi.fn() }
      });

      // When the record is read.
      const result = createBrowserSoloStorage().read();

      // Then no partial record is returned and only the solo record is cleared.
      expect(result).toEqual({
        record: null,
        notice: "Saved solo progress was invalid and was reset."
      });
      expect(removeItem).toHaveBeenCalledWith(SOLO_STORAGE_KEY);
      vi.unstubAllGlobals();
    }
  });

  it("keeps an in-memory game usable when browser storage is denied or full", () => {
    // Given browser storage that throws on both access paths.
    const getItem = vi.fn(() => {
      throw new Error("denied");
    });
    const setItem = vi.fn(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("window", { sessionStorage: { getItem, setItem, removeItem: vi.fn() } });
    const storage = createBrowserSoloStorage();

    // When the caller reads then writes a valid compact replay.
    const restored = storage.read();
    const notice = storage.write(record);

    // Then both failures are reported without throwing.
    expect(restored.record).toBeNull();
    expect(restored.notice).toContain("cannot be restored");
    expect(notice).toContain("cannot be saved");
  });

  it("accepts a compact valid replay at the size boundary", () => {
    // Given a valid record that fits inside the raw storage cap.
    const setItem = vi.fn();
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => JSON.stringify(record), setItem, removeItem: vi.fn() }
    });
    const storage = createBrowserSoloStorage();

    // When it is restored and saved.
    const restored = storage.read();
    const notice = storage.write(record);

    // Then the valid data round-trips and remains below the fixed cap.
    expect(restored.record).toEqual(record);
    expect(notice).toBeNull();
    expect(setItem.mock.calls[0]![1].length).toBeLessThan(SOLO_STORAGE_MAX_BYTES);
  });
});
