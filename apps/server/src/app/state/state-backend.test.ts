import { describe, expect, it } from "vitest";
import { parseStateBackend } from "./state-backend.js";

describe("state backend parsing", () => {
  it("defaults to memory when unset", () => {
    expect(parseStateBackend(undefined)).toBe("memory");
  });

  it("accepts supported backends", () => {
    expect(parseStateBackend("memory")).toBe("memory");
    expect(parseStateBackend("redis")).toBe("redis");
  });

  it("rejects unsupported backends", () => {
    expect(() => parseStateBackend("postgres")).toThrow('Unsupported STATE_BACKEND "postgres"');
  });
});
