export const DEFAULT_SERVER_PORT = 3001;
export const ROOM_CODE_LENGTH = 5;
export const INVITE_TOKEN_LENGTH = 22;
// The engine owns the bomb rule; re-exported so consumers of the protocol read one source.
export { getBombDeficit, MIN_BOMB_DEFICIT } from "@minesweeper-flags/game-engine";
