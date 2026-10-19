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
    (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
      localStorage
    };

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
    (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
      localStorage
    };
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

  describe("when storage is full or blocked", () => {
    const session = {
      roomId: "room-1",
      roomCode: "ABCDE",
      inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
      playerId: "player-1",
      displayName: "Host",
      sessionToken: "session-1"
    };

    class FailingStorage extends MemoryStorage {
      constructor(private readonly failing: Array<"getItem" | "setItem" | "removeItem">) {
        super();
      }

      override getItem(key: string): string | null {
        if (this.failing.includes("getItem")) throw new Error("blocked");
        return super.getItem(key);
      }

      override setItem(key: string, value: string): void {
        if (this.failing.includes("setItem")) throw new Error("QuotaExceededError");
        super.setItem(key, value);
      }

      override removeItem(key: string): void {
        if (this.failing.includes("removeItem")) throw new Error("blocked");
        super.removeItem(key);
      }
    }

    const installStorage = (localStorage: FailingStorage): void => {
      (globalThis as unknown as { window: { localStorage: FailingStorage } }).window = {
        localStorage
      };
    };

    it("does not throw when a session write fails", () => {
      // Given storage whose setItem throws
      const localStorage = new FailingStorage(["setItem"]);
      installStorage(localStorage);

      // When a session is stored
      const act = () => storeSession(session);

      // Then the call does not throw
      expect(act).not.toThrow();

      // And nothing is saved
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    });

    it("reads as no stored session when getItem throws", () => {
      // Given storage whose getItem throws
      installStorage(new FailingStorage(["getItem"]));

      // When the session is read
      const result = getStoredSession("ABCDE");

      // Then the result is null
      expect(result).toBeNull();
    });

    it("reads as no stored session when cleanup of an invalid payload throws", () => {
      // Given an invalid stored payload and storage whose removeItem throws
      const localStorage = new FailingStorage(["removeItem"]);
      localStorage.setItem(SESSION_KEY, "{not-json");
      installStorage(localStorage);

      // When the session is read
      let session: ReturnType<typeof getStoredSession> | undefined;
      const act = () => {
        session = getStoredSession("ABCDE");
      };

      // Then nothing throws
      expect(act).not.toThrow();

      // And the result is null
      expect(session).toBeNull();
    });

    it("does not throw when a session removal fails", () => {
      // Given storage whose removeItem throws
      installStorage(new FailingStorage(["removeItem"]));

      // When the session is removed
      const act = () => removeStoredSession("ABCDE");

      // Then the call does not throw
      expect(act).not.toThrow();
    });
  });
});
