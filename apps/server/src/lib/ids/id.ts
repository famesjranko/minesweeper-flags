import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { ROOM_CODE_LENGTH } from "@minesweeper-flags/shared";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const createId = (): string => randomUUID();

export const createRoomCode = (): string =>
  Array.from({ length: ROOM_CODE_LENGTH }, () => {
    const index = randomInt(ROOM_CODE_ALPHABET.length);
    return ROOM_CODE_ALPHABET[index]!;
  }).join("");

export const createInviteToken = (): string => randomBytes(16).toString("base64url");
