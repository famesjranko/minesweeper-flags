import { describe, expect, it } from "vitest";
import { getBombPreviewBounds } from "./bomb-preview.js";

describe("getBombPreviewBounds", () => {
  it("locks a top-left hover to a full 5x5 footprint", () => {
    expect(getBombPreviewBounds(16, 16, 0, 0)).toEqual({
      minRow: 0,
      maxRow: 4,
      minColumn: 0,
      maxColumn: 4
    });
  });

  it("locks a bottom-right hover to a full 5x5 footprint", () => {
    expect(getBombPreviewBounds(16, 16, 15, 15)).toEqual({
      minRow: 11,
      maxRow: 15,
      minColumn: 11,
      maxColumn: 15
    });
  });

  it("uses the full board when the board is smaller than the bomb footprint", () => {
    expect(getBombPreviewBounds(4, 4, 0, 0)).toEqual({
      minRow: 0,
      maxRow: 3,
      minColumn: 0,
      maxColumn: 3
    });
  });
});
