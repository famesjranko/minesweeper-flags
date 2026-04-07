import type { MatchState } from "@minesweeper-flags/game-engine";
import type { ChatMessageDto } from "@minesweeper-flags/shared";
import type { P2PGuestSessionRecord, P2PHostSessionRecord } from "./p2p-host-session.js";

export interface P2PRoomPlayerRecord {
  playerId: string;
  displayName: string;
}

export interface P2PHostRoomRecord {
  roomId: string;
  roomCode: string;
  inviteToken: string | null;
  players: P2PRoomPlayerRecord[];
  nextStarterIndex: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface P2PHostRuntimeState {
  room: P2PHostRoomRecord | null;
  hostSession: P2PHostSessionRecord | null;
  guestSession: P2PGuestSessionRecord | null;
  chatMessages: ChatMessageDto[];
  match: MatchState | null;
}

export type P2PHostAuthoritySnapshot = P2PHostRuntimeState;

const cloneRoomPlayers = (players: readonly P2PRoomPlayerRecord[]): P2PRoomPlayerRecord[] =>
  players.map((player) => ({ ...player }));

const cloneChatMessages = (messages: readonly ChatMessageDto[]): ChatMessageDto[] =>
  messages.map((message) => ({ ...message }));

export const cloneP2PHostRuntimeState = (state: P2PHostAuthoritySnapshot): P2PHostRuntimeState => ({
  room: state.room ? { ...state.room, players: cloneRoomPlayers(state.room.players) } : null,
  hostSession: state.hostSession ? { ...state.hostSession } : null,
  guestSession: state.guestSession ? { ...state.guestSession } : null,
  chatMessages: cloneChatMessages(state.chatMessages),
  match: state.match ? structuredClone(state.match) : null
});

export const createInitialP2PHostRuntimeState = (): P2PHostRuntimeState => ({
  room: null,
  hostSession: null,
  guestSession: null,
  chatMessages: [],
  match: null
});
