import { describe, expect, it } from "vitest";
import { buildInvitePath, extractInviteToken } from "./invite-link.js";

describe("invite link helpers", () => {
  const inviteToken = "AbCdEfGhIjKlMnOpQrStUw";

  it("extracts a raw invite token", () => {
    expect(extractInviteToken(inviteToken)).toBe(inviteToken);
  });

  it("rejects non-invite values", () => {
    expect(extractInviteToken("ABCDE")).toBeNull();
    expect(extractInviteToken("https://example.com/room/ABCDE")).toBeNull();
    expect(extractInviteToken(`https://example.com/invite/${inviteToken}`)).toBeNull();
  });

  it("builds a token-based invite path", () => {
    expect(buildInvitePath(inviteToken)).toBe(`/invite/${inviteToken}`);
  });
});
