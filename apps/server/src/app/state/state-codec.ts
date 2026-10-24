import { DEFAULT_BOARD_SIZE, type MatchState } from "@minesweeper-flags/game-engine";
import type { ChatMessageRecord } from "../../modules/chat/chat.types.js";
import type { RoomRecord } from "../../modules/rooms/room.types.js";
import type { PlayerSession } from "../realtime/player-session.service.js";

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

export const serializeRoomRecord = (room: RoomRecord): string => JSON.stringify(room);

// Rooms stored before board sizes existed have no boardSize; they were all classic.
export const deserializeRoomRecord = (value: string): RoomRecord => {
  const room = parseJson<Omit<RoomRecord, "boardSize"> & Partial<Pick<RoomRecord, "boardSize">>>(
    value
  );
  return { ...room, boardSize: room.boardSize ?? DEFAULT_BOARD_SIZE };
};

export const serializeMatchState = (matchState: MatchState): string => JSON.stringify(matchState);

export const deserializeMatchState = (value: string): MatchState => parseJson<MatchState>(value);

export const serializeChatMessageRecord = (message: ChatMessageRecord): string =>
  JSON.stringify(message);

export const deserializeChatMessageRecord = (value: string): ChatMessageRecord =>
  parseJson<ChatMessageRecord>(value);

export const serializePlayerSession = (session: PlayerSession): string => JSON.stringify(session);

export const deserializePlayerSession = (value: string): PlayerSession =>
  parseJson<PlayerSession>(value);
