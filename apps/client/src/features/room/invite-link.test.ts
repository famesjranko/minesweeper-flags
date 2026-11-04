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
    expect(extractInviteToken(`https://example.com/room/${inviteToken}`)).toBeNull();
    expect(extractInviteToken(`https://example.com/invite/${inviteToken}/extra`)).toBeNull();
    expect(extractInviteToken(`ftp://example.com/invite/${inviteToken}`)).toBeNull();
    expect(extractInviteToken("https://example.com/invite/ABCDE")).toBeNull();
  });

  it.each([
    ["a full link", `https://example.com/invite/${inviteToken}`],
    ["a plain HTTP link with a port", `http://192.0.2.10:5175/invite/${inviteToken}`],
    ["a link without its scheme", `example.com/invite/${inviteToken}`],
    ["a link with a trailing slash", `https://example.com/invite/${inviteToken}/`],
    ["a link with extra parameters", `https://example.com/invite/${inviteToken}?from=chat#top`],
    ["a link with spaces around it", `  https://example.com/invite/${inviteToken}\n`]
  ])("reads the code from %s", (_name, pasted) => {
    // Given a link a friend sent
    // When the player pastes it
    const token = extractInviteToken(pasted);

    // Then the code inside it is found
    expect(token).toBe(inviteToken);
  });

  it("builds a token-based invite path", () => {
    expect(buildInvitePath(inviteToken)).toBe(`/invite/${inviteToken}`);
  });
});
