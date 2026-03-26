import { randomUUID } from "node:crypto";
import { ROOM_CODE_LENGTH } from "@minesweeper-flags/shared";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const createId = (): string => randomUUID();

export const createRoomCode = (): string =>
  Array.from({ length: ROOM_CODE_LENGTH }, () => {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    return ROOM_CODE_ALPHABET[index]!;
  }).join("");

