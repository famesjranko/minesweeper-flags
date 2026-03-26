export interface RoomPlayer {
  playerId: string;
  displayName: string;
}

export interface RoomRecord {
  roomId: string;
  roomCode: string;
  players: RoomPlayer[];
  nextStarterIndex: 0 | 1;
  createdAt: number;
  updatedAt: number;
}
