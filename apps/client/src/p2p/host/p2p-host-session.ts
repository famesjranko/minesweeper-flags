import { INVITE_TOKEN_LENGTH, ROOM_CODE_LENGTH } from "@minesweeper-flags/shared";
import type { P2PHostRoomRecord, P2PRoomPlayerRecord } from "./p2p-host-state.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface P2PHostIdentityFactory {
  createId: () => string;
  createRoomCode: () => string;
  createInviteToken: () => string;
}

export interface P2PBaseSessionRecord {
  role: "host" | "guest";
  roomId: string;
  roomCode: string;
  playerId: string;
  displayName: string;
  sessionToken: string;
}

export interface P2PHostSessionRecord extends P2PBaseSessionRecord {
  role: "host";
}

export interface P2PGuestSessionRecord extends P2PBaseSessionRecord {
  role: "guest";
  bindingId: string | null;
}

export interface P2PBoundGuestCommandScope {
  roomCode: string;
  sessionToken: string;
}

const getCrypto = (): Crypto | null => {
  if (typeof globalThis.crypto === "undefined") {
    return null;
  }

  return globalThis.crypto;
};

const createRandomString = (alphabet: string, length: number): string => {
  const cryptoApi = getCrypto();

  if (cryptoApi) {
    const values = new Uint32Array(length);
    cryptoApi.getRandomValues(values);

    return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
  }

  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
};

export const createDefaultP2PHostIdentityFactory = (): P2PHostIdentityFactory => ({
  createId: () => getCrypto()?.randomUUID() ?? `p2p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  createRoomCode: () => createRandomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH),
  createInviteToken: () => createRandomString(TOKEN_ALPHABET, INVITE_TOKEN_LENGTH)
});

export const toRoomPlayerRecord = (
  session: Pick<P2PBaseSessionRecord, "playerId" | "displayName">
): P2PRoomPlayerRecord => ({
  playerId: session.playerId,
  displayName: session.displayName
});

export const createHostSessionRecord = (
  room: P2PHostRoomRecord,
  player: P2PRoomPlayerRecord,
  createSessionToken: () => string
): P2PHostSessionRecord => ({
  role: "host",
  roomId: room.roomId,
  roomCode: room.roomCode,
  playerId: player.playerId,
  displayName: player.displayName,
  sessionToken: createSessionToken()
});

export const createGuestSessionRecord = (
  room: P2PHostRoomRecord,
  player: P2PRoomPlayerRecord,
  createSessionToken: () => string,
  bindingId: string | null
): P2PGuestSessionRecord => ({
  role: "guest",
  roomId: room.roomId,
  roomCode: room.roomCode,
  playerId: player.playerId,
  displayName: player.displayName,
  sessionToken: createSessionToken(),
  bindingId
});

export const matchesGuestBinding = (
  session: Pick<P2PGuestSessionRecord, "bindingId">,
  bindingId: string | null
): boolean => session.bindingId === bindingId;

export const matchesGuestCommandScope = (
  session: Pick<P2PGuestSessionRecord, "roomCode" | "sessionToken">,
  scope: P2PBoundGuestCommandScope
): boolean => session.roomCode === scope.roomCode && session.sessionToken === scope.sessionToken;
