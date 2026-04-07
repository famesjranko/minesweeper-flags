import type { MatchState } from "@minesweeper-flags/game-engine";
import type { ChatMessageDto } from "@minesweeper-flags/shared";
import type { ClientSession, PlayerIdentity } from "../../app/providers/game-client.state.js";
import type { P2PGuestSessionRecord, P2PHostSessionRecord } from "../host/p2p-host-session.js";
import {
  cloneP2PHostRuntimeState,
  type P2PHostAuthoritySnapshot,
  type P2PHostRoomRecord
} from "../host/p2p-host-state.js";
import {
  P2P_RECOVERY_STORAGE_VERSION,
  hostAuthoritySnapshotSchema,
  hostReconnectMetadataSchema,
  recoveryRecordSchema
} from "./p2p-recovery-storage.schema.js";

export { P2P_RECOVERY_STORAGE_VERSION };

const P2P_RECOVERY_KEY_PREFIX = "msf:p2p-recovery:";

interface P2PRecoveryGuestReconnectMetadata {
  controlSessionId: string;
  guestSecret: string;
  lastInstanceId?: string;
}

interface P2PRecoveryHostReconnectMetadata {
  controlSessionId: string;
  hostSecret: string;
  guestSecret: string | null;
  lastInstanceId?: string;
}

export type P2PRecoveryHostReconnect = P2PRecoveryHostReconnectMetadata;

export interface P2PRecoveryGuestRecord {
  version: typeof P2P_RECOVERY_STORAGE_VERSION;
  role: "guest";
  roomId: ClientSession["roomId"];
  roomCode: ClientSession["roomCode"];
  playerId: ClientSession["playerId"];
  displayName: ClientSession["displayName"];
  sessionToken: ClientSession["sessionToken"];
  players: PlayerIdentity[];
  reconnect: P2PRecoveryGuestReconnectMetadata;
}

export interface P2PRecoveryHostRecord {
  version: typeof P2P_RECOVERY_STORAGE_VERSION;
  role: "host";
  room: P2PHostRoomRecord;
  hostSession: P2PHostSessionRecord;
  guestSession: P2PGuestSessionRecord | null;
  chatMessages: ChatMessageDto[];
  match: MatchState | null;
  reconnect: P2PRecoveryHostReconnectMetadata;
}

export type P2PRecoveryRecord = P2PRecoveryGuestRecord | P2PRecoveryHostRecord;

export interface P2PRecoveryPersistence {
  read: (roomCode: string) => P2PRecoveryRecord | null;
  write: (record: P2PRecoveryRecord) => void;
  remove: (roomCode: string) => void;
}

const cloneHostReconnectMetadata = (
  reconnect: P2PRecoveryHostReconnectMetadata
): P2PRecoveryHostReconnectMetadata => ({
  controlSessionId: reconnect.controlSessionId,
  hostSecret: reconnect.hostSecret,
  guestSecret: reconnect.guestSecret,
  ...(reconnect.lastInstanceId ? { lastInstanceId: reconnect.lastInstanceId } : {})
});

export const validateHostAuthoritySnapshot = (
  value: unknown
): P2PHostAuthoritySnapshot | null => {
  const result = hostAuthoritySnapshotSchema.safeParse(value);

  if (!result.success) {
    return null;
  }

  // Clone from the original input rather than result.data so property ordering
  // is preserved as it appeared in the source value. safeParse reconstructs
  // the object in the schema's declared field order, which breaks the
  // serializeRecoveryRecord contract that JSON.stringify(record) is byte-equal
  // to what the host runtime produced (e.g. createMatchState's key ordering).
  return cloneP2PHostRuntimeState(value as P2PHostAuthoritySnapshot);
};

export const createHostRecoveryRecord = ({
  state,
  reconnect
}: {
  state: P2PHostAuthoritySnapshot;
  reconnect: P2PRecoveryHostReconnect;
}): P2PRecoveryHostRecord => {
  const snapshot = validateHostAuthoritySnapshot(state);
  const reconnectResult = hostReconnectMetadataSchema.safeParse(reconnect);

  if (!snapshot || !snapshot.room || !snapshot.hostSession || !reconnectResult.success) {
    throw new Error("Invalid host recovery snapshot.");
  }

  const { room, hostSession, guestSession, chatMessages, match } = snapshot;

  return {
    version: P2P_RECOVERY_STORAGE_VERSION,
    role: "host",
    room,
    hostSession,
    guestSession,
    chatMessages,
    match,
    reconnect: cloneHostReconnectMetadata(reconnect)
  };
};

export const extractHostRecoveryState = (
  record: P2PRecoveryHostRecord
): P2PHostAuthoritySnapshot => {
  const snapshot = validateHostAuthoritySnapshot(record);

  if (!snapshot || !snapshot.room || !snapshot.hostSession) {
    throw new Error("Invalid host recovery snapshot.");
  }

  return snapshot;
};

const serializeRecoveryRecord = (record: P2PRecoveryRecord): string =>
  JSON.stringify(
    record.role === "guest"
      ? {
          version: P2P_RECOVERY_STORAGE_VERSION,
          role: "guest",
          roomId: record.roomId,
          roomCode: record.roomCode,
          playerId: record.playerId,
          displayName: record.displayName,
          sessionToken: record.sessionToken,
          players: record.players.map((player) => ({ ...player })),
          reconnect: {
            controlSessionId: record.reconnect.controlSessionId,
            guestSecret: record.reconnect.guestSecret,
            ...(record.reconnect.lastInstanceId
              ? { lastInstanceId: record.reconnect.lastInstanceId }
              : {})
          }
        }
      : {
          version: P2P_RECOVERY_STORAGE_VERSION,
          role: "host",
          ...extractHostRecoveryState(record),
          reconnect: cloneHostReconnectMetadata(record.reconnect)
        }
  );

const getRecoveryRecordRoomCode = (record: P2PRecoveryRecord): string =>
  record.role === "guest" ? record.roomCode : record.room.roomCode;

const createP2PRecoveryStorageKey = (roomCode: string) => `${P2P_RECOVERY_KEY_PREFIX}${roomCode}`;

const getBrowserStorage = (): Storage | null => {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
};

export const createBrowserP2PRecoveryPersistence = (): P2PRecoveryPersistence => ({
  read: (roomCode) => {
    const storage = getBrowserStorage();

    if (!storage) {
      return null;
    }

    const storageKey = createP2PRecoveryStorageKey(roomCode);
    const value = storage.getItem(storageKey);

    if (!value) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      storage.removeItem(storageKey);
      return null;
    }

    const result = recoveryRecordSchema.safeParse(parsed);
    if (!result.success) {
      storage.removeItem(storageKey);
      return null;
    }

    // Use the validated source value (not result.data) so property order is
    // preserved as it appeared in storage. This matches the byte-for-byte
    // round-trip that callers depend on when comparing serialized records.
    const record = parsed as P2PRecoveryRecord;

    // roomCode cross-check is a caller-intent check, not structural. It stays
    // outside the schema so the schema can be reused for snapshots that aren't
    // scoped to a particular caller-provided roomCode.
    const storedRoomCode = record.role === "guest" ? record.roomCode : record.room.roomCode;
    if (storedRoomCode !== roomCode) {
      storage.removeItem(storageKey);
      return null;
    }

    return record;
  },
  write: (record) => {
    const storage = getBrowserStorage();

    if (!storage) {
      return;
    }

    storage.setItem(
      createP2PRecoveryStorageKey(getRecoveryRecordRoomCode(record)),
      serializeRecoveryRecord(record)
    );
  },
  remove: (roomCode) => {
    const storage = getBrowserStorage();

    if (!storage) {
      return;
    }

    storage.removeItem(createP2PRecoveryStorageKey(roomCode));
  }
});

const browserP2PRecoveryPersistence = createBrowserP2PRecoveryPersistence();

export const getStoredP2PRecoveryRecord = (roomCode: string): P2PRecoveryRecord | null =>
  browserP2PRecoveryPersistence.read(roomCode);

export const storeP2PRecoveryRecord = (record: P2PRecoveryRecord): void => {
  browserP2PRecoveryPersistence.write(record);
};

export const removeStoredP2PRecoveryRecord = (roomCode: string): void => {
  browserP2PRecoveryPersistence.remove(roomCode);
};
