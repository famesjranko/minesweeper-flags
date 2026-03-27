import { afterEach, describe, expect, it } from "vitest";
import {
  createBrowserSessionPersistence,
  getStoredSession,
  removeStoredSession,
  storeSession
} from "./session-storage.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const SESSION_KEY = "msf:session:ABCDE";

describe("session storage", () => {
  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
  });

  it("persists only the canonical stored-session shape", () => {
    const localStorage = new MemoryStorage();
    (globalThis as { window: { localStorage: MemoryStorage } }).window = { localStorage };

    storeSession({
      roomId: "room-1",
      roomCode: "ABCDE",
      inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
      playerId: "player-1",
      displayName: "Host",
      sessionToken: "session-1",
      players: [
        {
          playerId: "player-1",
          displayName: "Host"
        }
      ]
    } as Parameters<typeof storeSession>[0] & {
      players: Array<{ playerId: string; displayName: string }>;
    });

    expect(localStorage.getItem(SESSION_KEY)).toBe(
      JSON.stringify({
        roomId: "room-1",
        roomCode: "ABCDE",
        inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
        playerId: "player-1",
        displayName: "Host",
        sessionToken: "session-1"
      })
    );
  });

  it("drops invalid or over-wide persisted payloads on read", () => {
    const localStorage = new MemoryStorage();
    (globalThis as { window: { localStorage: MemoryStorage } }).window = { localStorage };
    const persistence = createBrowserSessionPersistence();

    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        roomId: "room-1",
        roomCode: "ABCDE",
        inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
        playerId: "player-1",
        displayName: "Host",
        sessionToken: "session-1",
        players: [
          {
            playerId: "player-1",
            displayName: "Host"
          }
        ]
      })
    );

    expect(persistence.read("ABCDE")).toEqual({
      roomId: "room-1",
      roomCode: "ABCDE",
      inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
      playerId: "player-1",
      displayName: "Host",
      sessionToken: "session-1"
    });

    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        roomCode: "ABCDE"
      })
    );

    expect(getStoredSession("ABCDE")).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();

    localStorage.setItem(SESSION_KEY, "{not-json");

    expect(getStoredSession("ABCDE")).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();

    removeStoredSession("ABCDE");
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
