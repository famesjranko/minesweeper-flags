import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserSoloStorage,
  SOLO_STORAGE_KEY,
  SOLO_STORAGE_MAX_ACTIONS,
  SOLO_STORAGE_MAX_BYTES,
  validateSoloReplay
} from "./solo-storage.js";

const record = {
  version: 1 as const,
  seed: 4,
  createdAt: 7,
  starter: "human" as const,
  difficulty: "normal" as const,
  actions: []
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it("round-trips a compact valid replay", () => {
    // Given a complete valid replay and a browser store that returns its last saved value.
    const savedRecord = {
      ...record,
      actions: [{ type: "select" as const, playerId: "solo-human" as const, row: 0, column: 0 }]
    };
    let savedValue: string | null = null;
    const setItem = vi.fn((_key: string, value: string) => {
      savedValue = value;
    });
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => savedValue, setItem, removeItem: vi.fn() }
    });
    const storage = createBrowserSoloStorage();

    // When it is saved and restored from the same backing store.
    const notice = storage.write(savedRecord);
    const restored = storage.read();

    // Then the complete saved record round-trips and remains below the fixed cap.
    expect(restored.record).toEqual(savedRecord);
    expect(restored.record?.actions).toEqual(savedRecord.actions);
    expect(notice).toBeNull();
    expect(setItem.mock.calls[0]![1].length).toBeLessThan(SOLO_STORAGE_MAX_BYTES);
  });
});

const installRaw = (raw: string | null) => {
  const removeItem = vi.fn();
  vi.stubGlobal("window", {
    sessionStorage: { getItem: () => raw, setItem: vi.fn(), removeItem }
  });
  return removeItem;
};

it("accepts exactly 32 KiB and rejects one extra byte before parsing", () => {
  // Given valid JSON padded with permitted whitespace to the exact ASCII byte cap.
  const raw = JSON.stringify(record).padEnd(SOLO_STORAGE_MAX_BYTES, " ");
  const parse = vi.spyOn(JSON, "parse");
  installRaw(raw);

  // When the exact boundary and then one byte over it are read.
  const valid = createBrowserSoloStorage().read();
  parse.mockClear();
  const removeItem = installRaw(`${raw} `);
  const invalid = createBrowserSoloStorage().read();

  // Then the exact boundary restores and oversized input never reaches the parser.
  expect(valid).toEqual({ record, notice: null });
  expect(invalid.record).toBeNull();
  expect(invalid.notice).toContain("invalid");
  expect(parse).not.toHaveBeenCalled();
  expect(removeItem.mock.calls).toEqual([[SOLO_STORAGE_KEY]]);
  parse.mockRestore();
});

it("accepts 256 action tuples in shape validation and rejects 257 without truncation", () => {
  // Given structurally valid tuples whose gameplay validity is checked by the session.
  const action = { type: "select", playerId: "solo-human", row: 15, column: 0 };
  const atLimit = { ...record, actions: Array.from({ length: 256 }, () => ({ ...action })) };

  // When the shape boundary and one extra action are validated.
  const valid = validateSoloReplay(atLimit);
  const invalid = validateSoloReplay({ ...atLimit, actions: [...atLimit.actions, action] });

  // Then the whole boundary record is retained and the oversized record is rejected.
  expect(valid?.actions).toHaveLength(256);
  expect(invalid).toBeNull();
});

it.each([
  ["version", { ...record, version: 2 }],
  ["seed type", { ...record, seed: "4" }],
  ["seed fraction", { ...record, seed: 0.5 }],
  ["seed negative", { ...record, seed: -1 }],
  ["seed overflow", { ...record, seed: 0x100000000 }],
  ["timestamp fraction", { ...record, createdAt: 0.5 }],
  ["timestamp overflow", { ...record, createdAt: Number.MAX_SAFE_INTEGER }],
  ["starter", { ...record, starter: "guest" }],
  ["actions type", { ...record, actions: {} }],
  ["actor", { ...record, actions: [{ type: "select", playerId: "guest", row: 0, column: 0 }] }],
  [
    "action",
    { ...record, actions: [{ type: "reveal", playerId: "solo-human", row: 0, column: 0 }] }
  ],
  [
    "coordinate",
    { ...record, actions: [{ type: "select", playerId: "solo-human", row: 16, column: 0 }] }
  ],
  [
    "coordinate fraction",
    { ...record, actions: [{ type: "select", playerId: "solo-human", row: 0, column: 0.5 }] }
  ],
  ["resignation", { ...record, resignedBy: "guest" }],
  ["difficulty", { ...record, difficulty: "expert" }],
  ["inherited difficulty", { ...record, difficulty: "constructor" }],
  ["copied board", { ...record, board: [] }]
])("rejects invalid %s with a valid record control", (_name, invalid) => {
  // Given a valid replay and one malformed value of the same record.
  installRaw(JSON.stringify(record));
  const control = createBrowserSoloStorage().read();
  const removeItem = installRaw(JSON.stringify(invalid));

  // When the malformed record is restored.
  const result = createBrowserSoloStorage().read();

  // Then it fails closed while the control restores and only the solo key is cleared.
  expect(control).toEqual({ record, notice: null });
  expect(result.record).toBeNull();
  expect(result.notice).toContain("invalid");
  expect(removeItem.mock.calls).toEqual([[SOLO_STORAGE_KEY]]);
});

it.each([
  ["NUL", `${JSON.stringify(record)}\u0000`],
  ["control", `${JSON.stringify(record)}\u000b`],
  ["nonfinite JSON number", JSON.stringify(record).replace('"seed":4', '"seed":1e400')],
  [
    "nesting",
    JSON.stringify(record).replace(
      '"actions":[]',
      `"actions":${"[".repeat(128)}0${"]".repeat(128)}`
    )
  ]
])("rejects %s while allowing ordinary JSON whitespace", (_name, raw) => {
  // Given a whitespace-wrapped valid control and malformed bytes or nested content within the cap.
  installRaw(` \t\r\n${JSON.stringify(record)}\n`);
  const control = createBrowserSoloStorage().read();
  const removeItem = installRaw(raw);

  // When the malformed input is restored.
  const result = createBrowserSoloStorage().read();

  // Then restoration rejects the entire input and preserves the valid control.
  expect(control).toEqual({ record, notice: null });
  expect(result.record).toBeNull();
  expect(result.notice).toContain("invalid");
  expect(removeItem.mock.calls).toEqual([[SOLO_STORAGE_KEY]]);
});

it("reserves safe timestamps for all actions and a resignation", () => {
  // Given the maximum timestamp that leaves room for 256 actions and one resignation.
  const boundary = { ...record, createdAt: Number.MAX_SAFE_INTEGER - 257, seed: 0xffffffff };

  // When the boundary, its successor, and nonfinite timestamps are validated.
  const valid = validateSoloReplay(boundary);
  const invalid = [boundary.createdAt + 1, NaN, Infinity, -Infinity].map((createdAt) =>
    validateSoloReplay({ ...record, createdAt })
  );

  // Then only the timestamp that keeps every generated time safe is accepted.
  expect(valid).toEqual(boundary);
  expect(invalid).toEqual([null, null, null, null]);
});

it("distinguishes a missing record from malformed JSON", () => {
  // Given a browser with no solo record.
  const removeItem = installRaw(null);

  // When storage is read.
  const result = createBrowserSoloStorage().read();

  // Then absence is a valid fresh start and clears nothing.
  expect(result).toEqual({ record: null, notice: null });
  expect(removeItem).not.toHaveBeenCalled();
});

it("restores a record saved before bot levels existed at the normal level", () => {
  // Given a saved replay from an earlier release, with no level field.
  const { difficulty: _omitted, ...oldRecord } = record;
  installRaw(JSON.stringify(oldRecord));

  // When the record is restored.
  const result = createBrowserSoloStorage().read();

  // Then the replay is kept and plays at the normal level.
  expect(result).toEqual({ record: { ...oldRecord, difficulty: "normal" }, notice: null });
});

it("keeps the saved level of a current record", () => {
  // Given a saved replay played at the hard level.
  installRaw(JSON.stringify({ ...record, difficulty: "hard" }));

  // When the record is restored.
  const result = createBrowserSoloStorage().read();

  // Then the hard level is restored with it.
  expect(result.record?.difficulty).toBe("hard");
});
