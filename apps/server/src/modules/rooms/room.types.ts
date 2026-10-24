import type { BoardSize } from "@minesweeper-flags/game-engine";

export interface RoomPlayer {
  playerId: string;
  displayName: string;
}

export interface RoomRecord {
  roomId: string;
  roomCode: string;
  inviteToken: string | null;
  players: RoomPlayer[];
  nextStarterIndex: 0 | 1;
  boardSize: BoardSize;
  createdAt: number;
  updatedAt: number;
}
