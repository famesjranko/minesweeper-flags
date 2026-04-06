import type { BoardCell, BoardState, MatchState, PlayerMatchState, ResolvedAction } from "@minesweeper-flags/game-engine";
import type { ChatMessageDto } from "@minesweeper-flags/shared";
import type { ClientSession, PlayerIdentity } from "../../app/providers/game-client.state.js";
import type { P2PGuestSessionRecord, P2PHostSessionRecord } from "../host/p2p-host-session.js";
import {
  cloneP2PHostRuntimeState,
  type P2PHostAuthoritySnapshot,
  type P2PHostRoomRecord
} from "../host/p2p-host-state.js";

export const P2P_RECOVERY_STORAGE_VERSION = 1;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isOptionalString = (value: unknown): value is string | undefined =>
  typeof value === "undefined" || typeof value === "string";

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isPlayerIdentity = (value: unknown): value is PlayerIdentity => {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.playerId) && isString(value.displayName);
};

const isPlayerIdentityList = (value: unknown): value is PlayerIdentity[] =>
  Array.isArray(value) && value.every(isPlayerIdentity);

const isChatMessage = (value: unknown): value is ChatMessageDto => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.messageId) &&
    isString(value.playerId) &&
    isString(value.displayName) &&
    isString(value.text) &&
    typeof value.sentAt === "number"
  );
};

const isChatMessageList = (value: unknown): value is ChatMessageDto[] =>
  Array.isArray(value) && value.every(isChatMessage);

const isHostRoomRecord = (value: unknown): value is P2PHostRoomRecord => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.roomId) &&
    isString(value.roomCode) &&
    isNullableString(value.inviteToken) &&
    isPlayerIdentityList(value.players) &&
    (value.nextStarterIndex === 0 || value.nextStarterIndex === 1) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
};

const isHostSessionRecord = (value: unknown): value is P2PHostSessionRecord => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.role === "host" &&
    isString(value.roomId) &&
    isString(value.roomCode) &&
    isString(value.playerId) &&
    isString(value.displayName) &&
    isString(value.sessionToken)
  );
};

const isGuestSessionRecord = (value: unknown): value is P2PGuestSessionRecord => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.role === "guest" &&
    isString(value.roomId) &&
    isString(value.roomCode) &&
    isString(value.playerId) &&
    isString(value.displayName) &&
    isString(value.sessionToken) &&
    isNullableString(value.bindingId)
  );
};

const isBoardCell = (value: unknown): value is BoardCell => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isInteger(value.row) &&
    isInteger(value.column) &&
    isBoolean(value.hasMine) &&
    isInteger(value.adjacentMines) &&
    isBoolean(value.isRevealed) &&
    isNullableString(value.claimedByPlayerId)
  );
};

const isBoardState = (value: unknown): value is BoardState => {
  if (!isRecord(value) || !isInteger(value.rows) || !isInteger(value.columns) || !isInteger(value.mineCount)) {
    return false;
  }

  if (!Array.isArray(value.cells) || value.cells.length !== value.rows) {
    return false;
  }

  return value.cells.every(
    (row, rowIndex) =>
      Array.isArray(row) &&
      row.length === value.columns &&
      row.every(
        (cell, columnIndex) =>
          isBoardCell(cell) && cell.row === rowIndex && cell.column === columnIndex
      )
  );
};

const isPlayerMatchState = (value: unknown): value is PlayerMatchState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.playerId) &&
    isString(value.displayName) &&
    isInteger(value.score) &&
    (value.bombsRemaining === 0 || value.bombsRemaining === 1) &&
    isBoolean(value.connected) &&
    isBoolean(value.rematchRequested)
  );
};

const isResolvedAction = (value: unknown): value is ResolvedAction => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.type === "select" || value.type === "bomb") &&
    isString(value.playerId) &&
    isInteger(value.row) &&
    isInteger(value.column) &&
    (value.outcome === "mine_claimed" || value.outcome === "safe_reveal" || value.outcome === "bomb_used") &&
    isInteger(value.revealedCount) &&
    isInteger(value.claimedMineCount) &&
    (typeof value.claimedMineCoordinates === "undefined" ||
      (Array.isArray(value.claimedMineCoordinates) &&
        value.claimedMineCoordinates.every(
          (coordinate) => isRecord(coordinate) && isInteger(coordinate.row) && isInteger(coordinate.column)
        )))
  );
};

const isMatchSnapshot = (value: unknown): value is MatchState => {
  if (!isRecord(value)) {
    return false;
  }

  if (!Array.isArray(value.players) || value.players.length !== 2 || !value.players.every(isPlayerMatchState)) {
    return false;
  }

  const players = value.players as [PlayerMatchState, PlayerMatchState];
  const playerIds = players.map((player) => player.playerId);
  const hasCurrentTurnPlayer =
    value.currentTurnPlayerId === null ||
    (isString(value.currentTurnPlayerId) && playerIds.includes(value.currentTurnPlayerId));
  const hasWinnerPlayer =
    value.winnerPlayerId === null ||
    (isString(value.winnerPlayerId) && playerIds.includes(value.winnerPlayerId));
  const lastActionPlayerInMatch =
    value.lastAction === null || (isResolvedAction(value.lastAction) && playerIds.includes(value.lastAction.playerId));
  const hasValidPhaseState =
    (value.phase === "live" &&
      value.turnPhase === "awaiting_action" &&
      value.currentTurnPlayerId !== null &&
      value.winnerPlayerId === null) ||
    (value.phase === "finished" && value.turnPhase === "ended" && value.currentTurnPlayerId === null);

  return (
    isString(value.roomId) &&
    (value.phase === "live" || value.phase === "finished") &&
    isBoardState(value.board) &&
    hasCurrentTurnPlayer &&
    (value.turnPhase === "awaiting_action" || value.turnPhase === "ended") &&
    isInteger(value.turnNumber) &&
    value.turnNumber >= 1 &&
    hasWinnerPlayer &&
    (value.lastAction === null || isResolvedAction(value.lastAction)) &&
    lastActionPlayerInMatch &&
    hasValidPhaseState &&
    typeof value.seed === "number" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
};

const cloneHostReconnectMetadata = (
  reconnect: P2PRecoveryHostReconnectMetadata
): P2PRecoveryHostReconnectMetadata => ({
  controlSessionId: reconnect.controlSessionId,
  hostSecret: reconnect.hostSecret,
  guestSecret: reconnect.guestSecret,
  ...(reconnect.lastInstanceId ? { lastInstanceId: reconnect.lastInstanceId } : {})
});

export const validateHostAuthoritySnapshot = (value: unknown): P2PHostAuthoritySnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !(value.room === null || isHostRoomRecord(value.room)) ||
    !(value.hostSession === null || isHostSessionRecord(value.hostSession)) ||
    !(value.guestSession === null || isGuestSessionRecord(value.guestSession)) ||
    !isChatMessageList(value.chatMessages) ||
    !(value.match === null || isMatchSnapshot(value.match))
  ) {
    return null;
  }

  const room = value.room as P2PHostRoomRecord | null;
  const hostSession = value.hostSession as P2PHostSessionRecord | null;
  const guestSession = value.guestSession as P2PGuestSessionRecord | null;
  const match = value.match as MatchState | null;

  if ((room === null) !== (hostSession === null)) {
    return null;
  }

  if (guestSession !== null && room === null) {
    return null;
  }

  if (match !== null && (room === null || hostSession === null || guestSession === null)) {
    return null;
  }

  if (
    room !== null &&
    ((hostSession !== null &&
      (hostSession.roomId !== room.roomId || hostSession.roomCode !== room.roomCode)) ||
      (guestSession !== null &&
        (guestSession.roomId !== room.roomId || guestSession.roomCode !== room.roomCode)))
  ) {
    return null;
  }

  if (
    room !== null &&
    hostSession !== null &&
    !room.players.some(
      (player) => player.playerId === hostSession.playerId && player.displayName === hostSession.displayName
    )
  ) {
    return null;
  }

  if (room !== null && hostSession !== null && guestSession === null && room.players.length !== 1) {
    return null;
  }

  if (
    room !== null &&
    guestSession !== null &&
    !room.players.some(
      (player) => player.playerId === guestSession.playerId && player.displayName === guestSession.displayName
    )
  ) {
    return null;
  }

  if (
    hostSession !== null &&
    guestSession !== null &&
    (hostSession.playerId === guestSession.playerId || hostSession.sessionToken === guestSession.sessionToken)
  ) {
    return null;
  }

  if (
    room !== null &&
    hostSession !== null &&
    guestSession !== null &&
    (room.players.length !== 2 ||
      new Set(room.players.map((player) => player.playerId)).size !== room.players.length)
  ) {
    return null;
  }

  if (
    match !== null &&
    room !== null &&
    hostSession !== null &&
    guestSession !== null &&
    (match.roomId !== room.roomId ||
      match.players[0].playerId === match.players[1].playerId ||
      !match.players.some(
        (player) => player.playerId === hostSession.playerId && player.displayName === hostSession.displayName
      ) ||
      !match.players.some(
        (player) => player.playerId === guestSession.playerId && player.displayName === guestSession.displayName
      ))
  ) {
    return null;
  }

  return cloneP2PHostRuntimeState({
    room,
    hostSession,
    guestSession,
    chatMessages: value.chatMessages,
    match
  });
};

export const createHostRecoveryRecord = ({
  state,
  reconnect
}: {
  state: P2PHostAuthoritySnapshot;
  reconnect: P2PRecoveryHostReconnect;
}): P2PRecoveryHostRecord => {
  const snapshot = validateHostAuthoritySnapshot(state);

  if (!snapshot || !isString(reconnect.controlSessionId) || !isString(reconnect.hostSecret) || !isNullableString(reconnect.guestSecret)) {
    throw new Error("Invalid host recovery snapshot.");
  }

  if (!isOptionalString(reconnect.lastInstanceId)) {
    throw new Error("Invalid host recovery snapshot.");
  }

  if (!snapshot.room || !snapshot.hostSession) {
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

export const extractHostRecoveryState = (record: P2PRecoveryHostRecord): P2PHostAuthoritySnapshot => {
  const snapshot = validateHostAuthoritySnapshot(record);

  if (!snapshot || !snapshot.room || !snapshot.hostSession) {
    throw new Error("Invalid host recovery snapshot.");
  }

  return snapshot;
};

const normalizeGuestRecord = (
  value: Record<string, unknown>,
  expectedRoomCode: string
): P2PRecoveryGuestRecord | null => {
  if (
    value.role !== "guest" ||
    !isString(value.roomId) ||
    !isString(value.roomCode) ||
    !isString(value.playerId) ||
    !isString(value.displayName) ||
    !isString(value.sessionToken) ||
    !isPlayerIdentityList(value.players) ||
    !isRecord(value.reconnect) ||
    !isString(value.reconnect.controlSessionId) ||
    !isString(value.reconnect.guestSecret) ||
    !isOptionalString(value.reconnect.lastInstanceId)
  ) {
    return null;
  }

  if (value.roomCode !== expectedRoomCode) {
    return null;
  }

  return {
    version: P2P_RECOVERY_STORAGE_VERSION,
    role: "guest",
    roomId: value.roomId,
    roomCode: value.roomCode,
    playerId: value.playerId,
    displayName: value.displayName,
    sessionToken: value.sessionToken,
    players: value.players.map((player) => ({ ...player })),
    reconnect: {
      controlSessionId: value.reconnect.controlSessionId,
      guestSecret: value.reconnect.guestSecret,
      ...(typeof value.reconnect.lastInstanceId === "string"
        ? { lastInstanceId: value.reconnect.lastInstanceId }
        : {})
    }
  };
};

const normalizeHostRecord = (
  value: Record<string, unknown>,
  expectedRoomCode: string
): P2PRecoveryHostRecord | null => {
  const snapshot = validateHostAuthoritySnapshot(value);

  if (
    value.role !== "host" ||
    !snapshot ||
    !isRecord(value.reconnect) ||
    !isString(value.reconnect.controlSessionId) ||
    !isString(value.reconnect.hostSecret) ||
    !isNullableString(value.reconnect.guestSecret) ||
    !isOptionalString(value.reconnect.lastInstanceId)
  ) {
    return null;
  }

  if (
    snapshot.room === null ||
    snapshot.hostSession === null ||
    snapshot.room.roomCode !== expectedRoomCode
  ) {
    return null;
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
    reconnect: cloneHostReconnectMetadata({
      controlSessionId: value.reconnect.controlSessionId,
      hostSecret: value.reconnect.hostSecret,
      guestSecret: value.reconnect.guestSecret,
      ...(typeof value.reconnect.lastInstanceId === "string"
        ? { lastInstanceId: value.reconnect.lastInstanceId }
        : {})
    })
  };
};

const normalizeRecoveryRecord = (value: unknown, expectedRoomCode: string): P2PRecoveryRecord | null => {
  if (!isRecord(value) || value.version !== P2P_RECOVERY_STORAGE_VERSION) {
    return null;
  }

  switch (value.role) {
    case "guest":
      return normalizeGuestRecord(value, expectedRoomCode);
    case "host":
      return normalizeHostRecord(value, expectedRoomCode);
    default:
      return null;
  }
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

    try {
      const normalized = normalizeRecoveryRecord(JSON.parse(value), roomCode);

      if (!normalized) {
        storage.removeItem(storageKey);
      }

      return normalized;
    } catch {
      storage.removeItem(storageKey);
      return null;
    }
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
