import type { MatchState } from "@minesweeper-flags/game-engine";
import type { RoomRecord } from "../../modules/rooms/room.types.js";
import type { PlayerSession } from "../realtime/player-session.service.js";

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

export const serializeRoomRecord = (room: RoomRecord): string => JSON.stringify(room);

export const deserializeRoomRecord = (value: string): RoomRecord => parseJson<RoomRecord>(value);

export const serializeMatchState = (matchState: MatchState): string => JSON.stringify(matchState);

export const deserializeMatchState = (value: string): MatchState => parseJson<MatchState>(value);

export const serializePlayerSession = (session: PlayerSession): string => JSON.stringify(session);

export const deserializePlayerSession = (value: string): PlayerSession =>
  parseJson<PlayerSession>(value);
