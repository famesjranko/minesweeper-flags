import { afterEach, describe, expect, it } from "vitest";
import { createMatchState } from "@minesweeper-flags/game-engine";
import { storeSession } from "../../lib/socket/session-storage.js";
import {
  P2P_RECOVERY_STORAGE_VERSION,
  createBrowserP2PRecoveryPersistence,
  createHostRecoveryRecord,
  extractHostRecoveryState,
  getStoredP2PRecoveryRecord,
  removeStoredP2PRecoveryRecord,
  storeP2PRecoveryRecord,
  type P2PRecoveryGuestRecord,
  type P2PRecoveryHostRecord
} from "./p2p-recovery-storage.js";

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

type MockWindow = {
  localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
};

const ROOM_CODE = "ABCDE";
const P2P_RECOVERY_KEY = "msf:p2p-recovery:ABCDE";
const HOSTED_SESSION_KEY = "msf:session:ABCDE";

const guestRecord: P2PRecoveryGuestRecord = {
  version: P2P_RECOVERY_STORAGE_VERSION,
  role: "guest",
  roomId: "room-1",
  roomCode: ROOM_CODE,
  playerId: "player-2",
  displayName: "Guest",
  sessionToken: "guest-session-token",
  players: [
    { playerId: "player-1", displayName: "Host" },
    { playerId: "player-2", displayName: "Guest" }
  ],
  reconnect: {
    controlSessionId: "control-session-1",
    guestSecret: "guest-secret-1",
    lastInstanceId: "instance-1"
  }
};

const hostRecord: P2PRecoveryHostRecord = {
  version: P2P_RECOVERY_STORAGE_VERSION,
  role: "host",
  room: {
    roomId: "room-1",
    roomCode: ROOM_CODE,
    inviteToken: null,
    players: [
      { playerId: "player-1", displayName: "Host" },
      { playerId: "player-2", displayName: "Guest" }
    ],
    nextStarterIndex: 1,
    createdAt: 100,
    updatedAt: 200
  },
  hostSession: {
    role: "host",
    roomId: "room-1",
    roomCode: ROOM_CODE,
    playerId: "player-1",
    displayName: "Host",
    sessionToken: "host-session-token"
  },
  guestSession: {
    role: "guest",
    roomId: "room-1",
    roomCode: ROOM_CODE,
    playerId: "player-2",
    displayName: "Guest",
    sessionToken: "guest-session-token",
    bindingId: "binding-1"
  },
  chatMessages: [
    {
      messageId: "message-1",
      playerId: "player-1",
      displayName: "Host",
      text: "ready",
      sentAt: 300
    }
  ],
  match: createMatchState({
    roomId: "room-1",
    players: [
      { playerId: "player-1", displayName: "Host" },
      { playerId: "player-2", displayName: "Guest" }
    ],
    seed: 42,
    createdAt: 100,
    startingPlayerId: "player-1"
  }),
  reconnect: {
    controlSessionId: "control-session-1",
    hostSecret: "host-secret-1",
    guestSecret: "guest-secret-1",
    lastInstanceId: "instance-1"
  }
};

describe("p2p recovery storage", () => {
  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
  });

  it("reads, writes, and removes guest recovery records", () => {
    const localStorage = new MemoryStorage();
    (globalThis as unknown as { window: MockWindow }).window = { localStorage };

    storeP2PRecoveryRecord(guestRecord);

    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBe(JSON.stringify(guestRecord));
    expect(getStoredP2PRecoveryRecord(ROOM_CODE)).toEqual(guestRecord);

    removeStoredP2PRecoveryRecord(ROOM_CODE);

    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeNull();
    expect(getStoredP2PRecoveryRecord(ROOM_CODE)).toBeNull();
  });

  it("reads, writes, and removes host recovery records", () => {
    const localStorage = new MemoryStorage();
    (globalThis as unknown as { window: MockWindow }).window = { localStorage };

    const persistence = createBrowserP2PRecoveryPersistence();
    persistence.write(hostRecord);

    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBe(JSON.stringify(hostRecord));
    expect(persistence.read(ROOM_CODE)).toEqual(hostRecord);

    persistence.remove(ROOM_CODE);

    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeNull();
  });

  it("builds a host recovery record from runtime state and reconnect metadata", () => {
    const record = createHostRecoveryRecord({
      state: {
        room: hostRecord.room,
        hostSession: hostRecord.hostSession,
        guestSession: hostRecord.guestSession,
        chatMessages: hostRecord.chatMessages,
        match: hostRecord.match
      },
      reconnect: hostRecord.reconnect
    });

    expect(record).toEqual(hostRecord);
    expect(record.room).not.toBe(hostRecord.room);
    expect(record.chatMessages).not.toBe(hostRecord.chatMessages);
  });

  it("extracts host runtime state back from a host recovery record", () => {
    const state = extractHostRecoveryState(hostRecord);

    expect(state).toEqual({
      room: hostRecord.room,
      hostSession: hostRecord.hostSession,
      guestSession: hostRecord.guestSession,
      chatMessages: hostRecord.chatMessages,
      match: hostRecord.match
    });
    expect(state.room).not.toBe(hostRecord.room);
    expect(state.match).not.toBe(hostRecord.match);
  });

  it("preserves match field order across read/write (regression for safeParse reorder)", () => {
    const localStorage = new MemoryStorage();
    (globalThis as unknown as { window: MockWindow }).window = { localStorage };

    // Lock the test setup: createMatchState produces `players` at position 4,
    // while matchStateSchema declares `players` last. This divergence is what
    // makes the regression observable — if the engine's natural key ordering
    // ever drifts toward the schema's order, the assertions below stop being
    // meaningful (they would pass even with a buggy clone-from-result.data).
    // The guard tells a future contributor exactly what to do if this fires.
    const matchKeys = Object.keys(hostRecord.match!);
    expect(matchKeys.indexOf("players")).toBeLessThan(matchKeys.length - 1);

    const persistence = createBrowserP2PRecoveryPersistence();
    persistence.write(hostRecord);

    // Write path: validateHostAuthoritySnapshot must clone from the original
    // input (not safeParse's result.data) so the bytes written preserve the
    // engine's natural key order, not the schema's.
    const stored = localStorage.getItem(P2P_RECOVERY_KEY);
    expect(stored).toBe(JSON.stringify(hostRecord));

    // Read path: createBrowserP2PRecoveryPersistence.read must return the
    // original parsed value (not result.data) for the same reason.
    const readBack = persistence.read(ROOM_CODE);
    expect(readBack).not.toBeNull();
    expect(JSON.stringify(readBack)).toBe(JSON.stringify(hostRecord));
  });

  it("rejects malformed json and wrong versions, then clears them", () => {
    const localStorage = new MemoryStorage();
    (globalThis as unknown as { window: MockWindow }).window = { localStorage };

    localStorage.setItem(P2P_RECOVERY_KEY, "{not-json");

    expect(getStoredP2PRecoveryRecord(ROOM_CODE)).toBeNull();
    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeNull();

    localStorage.setItem(
      P2P_RECOVERY_KEY,
      JSON.stringify({
        ...guestRecord,
        version: P2P_RECOVERY_STORAGE_VERSION + 1
      })
    );

    expect(getStoredP2PRecoveryRecord(ROOM_CODE)).toBeNull();
    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeNull();
  });

  it("rejects invalid roles and malformed shapes, then clears them", () => {
    const localStorage = new MemoryStorage();
    (globalThis as unknown as { window: MockWindow }).window = { localStorage };

    localStorage.setItem(
      P2P_RECOVERY_KEY,
      JSON.stringify({
        ...guestRecord,
        role: "spectator"
      })
    );

    expect(getStoredP2PRecoveryRecord(ROOM_CODE)).toBeNull();
    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeNull();

    localStorage.setItem(
      P2P_RECOVERY_KEY,
      JSON.stringify({
        ...hostRecord,
        reconnect: {
          controlSessionId: "control-session-1",
          hostSecret: 123,
          guestSecret: "guest-secret-1"
        }
      })
    );

    expect(getStoredP2PRecoveryRecord(ROOM_CODE)).toBeNull();
    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeNull();

    localStorage.setItem(
      P2P_RECOVERY_KEY,
      JSON.stringify({
        ...hostRecord,
        match: {
          roomId: "room-1",
          phase: "live"
        }
      })
    );

    expect(getStoredP2PRecoveryRecord(ROOM_CODE)).toBeNull();
    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeNull();
  });

  it("rejects mismatched host authority relationships", () => {
    expect(() =>
      createHostRecoveryRecord({
        state: {
          room: hostRecord.room,
          hostSession: null,
          guestSession: hostRecord.guestSession,
          chatMessages: hostRecord.chatMessages,
          match: hostRecord.match
        },
        reconnect: hostRecord.reconnect
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      extractHostRecoveryState({
        ...hostRecord,
        guestSession: null,
        match: hostRecord.match
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      extractHostRecoveryState({
        ...hostRecord,
        room: {
          ...hostRecord.room,
          players: [{ playerId: "player-1", displayName: "Host" }]
        }
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      extractHostRecoveryState({
        ...hostRecord,
        guestSession: {
          ...hostRecord.guestSession!,
          playerId: hostRecord.hostSession.playerId,
          displayName: hostRecord.hostSession.displayName,
          sessionToken: "guest-session-token-2"
        }
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      extractHostRecoveryState({
        ...hostRecord,
        room: {
          ...hostRecord.room,
          players: [
            ...hostRecord.room.players,
            {
              playerId: "player-3",
              displayName: "Spectator"
            }
          ]
        }
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      extractHostRecoveryState({
        ...hostRecord,
        match: hostRecord.match
          ? {
              ...hostRecord.match,
              currentTurnPlayerId: null
            }
          : hostRecord.match
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      extractHostRecoveryState({
        ...hostRecord,
        match: hostRecord.match
          ? {
              ...hostRecord.match,
              lastAction: {
                type: "select",
                playerId: "outsider",
                row: 0,
                column: 0,
                outcome: "safe_reveal",
                revealedCount: 1,
                claimedMineCount: 0
              }
            }
          : hostRecord.match
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      createHostRecoveryRecord({
        state: {
          room: hostRecord.room,
          hostSession: hostRecord.hostSession,
          guestSession: hostRecord.guestSession,
          chatMessages: hostRecord.chatMessages,
          match: hostRecord.match
        },
        reconnect: {
          controlSessionId: "control-session-1",
          hostSecret: 123 as unknown as string,
          guestSecret: "guest-secret-1"
        }
      })
    ).toThrow("Invalid host recovery snapshot.");
  });

  it("uses a separate storage namespace from hosted session persistence", () => {
    const localStorage = new MemoryStorage();
    (globalThis as unknown as { window: MockWindow }).window = { localStorage };

    storeSession({
      roomId: "room-1",
      roomCode: ROOM_CODE,
      playerId: "player-1",
      displayName: "Host",
      sessionToken: "host-session-token"
    });
    storeP2PRecoveryRecord(guestRecord);

    expect(localStorage.getItem(HOSTED_SESSION_KEY)).toBeTruthy();
    expect(localStorage.getItem(P2P_RECOVERY_KEY)).toBeTruthy();
    expect(localStorage.getItem(HOSTED_SESSION_KEY)).not.toBe(localStorage.getItem(P2P_RECOVERY_KEY));
  });
});
