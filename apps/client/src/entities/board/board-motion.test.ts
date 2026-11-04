import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pressing a square", () => {
  it("keeps the square at full size, so a tap near its edge still lands", () => {
    // Given the styles applied to a square under a finger
    const stylesheet = readFileSync(new URL("./board-motion.css", import.meta.url), "utf8");
    const pressRules = stylesheet.split("}").filter((rule) => rule.includes(":active"));

    // When they are read without the comments that explain them
    const pressStyles = pressRules.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

    // Then there is a press style, and none of it changes the area the square covers
    expect(pressRules.length).toBeGreaterThan(0);
    expect(pressStyles).not.toMatch(/transform|scale|zoom|width|height|margin|inset/);
  });
});
