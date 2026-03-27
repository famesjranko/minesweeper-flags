import type { ChatMessageDto, MatchStateDto } from "@minesweeper-flags/shared";
import {
  appendChatMessage,
  createLobbyRuntimeState,
  type ClientSession
} from "./game-client.state.js";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface GameClientSnapshot {
  connectionStatus: ConnectionStatus;
  session: ClientSession | null;
  match: MatchStateDto | null;
  bombArmed: boolean;
  error: string | null;
  chatMessages: ChatMessageDto[];
  chatDraft: string;
  chatError: string | null;
  chatPendingText: string | null;
}

type Listener = () => void;

const createInitialSnapshot = (): GameClientSnapshot => ({
  connectionStatus: "disconnected",
  ...createLobbyRuntimeState()
});

const mergeRematchState = (
  match: MatchStateDto,
  players: Array<{ playerId: string; rematchRequested: boolean }>
): MatchStateDto => ({
  ...match,
  players: match.players.map((player) => ({
    ...player,
    rematchRequested:
      players.find((entry) => entry.playerId === player.playerId)?.rematchRequested ??
      player.rematchRequested
  })) as MatchStateDto["players"]
});

export class GameClientStore {
  private snapshot: GameClientSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(initialSnapshot: GameClientSnapshot = createInitialSnapshot()) {
    this.snapshot = initialSnapshot;
  }

  getSnapshot = (): GameClientSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  setConnectionStatus(status: ConnectionStatus): void {
    if (this.snapshot.connectionStatus === status) {
      return;
    }

    this.update((current) => ({
      ...current,
      connectionStatus: status
    }));
  }

  setSession(session: ClientSession | null): void {
    if (this.snapshot.session === session) {
      return;
    }

    this.update((current) => ({
      ...current,
      session
    }));
  }

  setError(error: string | null): void {
    if (this.snapshot.error === error) {
      return;
    }

    this.update((current) => ({
      ...current,
      error
    }));
  }

  clearError(): void {
    this.setError(null);
  }

  setMatch(match: MatchStateDto | null): void {
    if (this.snapshot.match === match) {
      return;
    }

    this.update((current) => ({
      ...current,
      match
    }));
  }

  setBombArmed(bombArmed: boolean): void {
    if (this.snapshot.bombArmed === bombArmed) {
      return;
    }

    this.update((current) => ({
      ...current,
      bombArmed
    }));
  }

  toggleBombMode(): void {
    this.update((current) => ({
      ...current,
      bombArmed: !current.bombArmed
    }));
  }

  setChatMessages(chatMessages: ChatMessageDto[]): void {
    this.update((current) => ({
      ...current,
      chatMessages
    }));
  }

  appendChatMessage(message: ChatMessageDto): void {
    this.update((current) => ({
      ...current,
      chatMessages: appendChatMessage(current.chatMessages, message)
    }));
  }

  setChatDraft(chatDraft: string): void {
    if (this.snapshot.chatDraft === chatDraft) {
      return;
    }

    this.update((current) => ({
      ...current,
      chatDraft
    }));
  }

  setChatError(chatError: string | null): void {
    if (this.snapshot.chatError === chatError) {
      return;
    }

    this.update((current) => ({
      ...current,
      chatError
    }));
  }

  setChatPendingText(chatPendingText: string | null): void {
    if (this.snapshot.chatPendingText === chatPendingText) {
      return;
    }

    this.update((current) => ({
      ...current,
      chatPendingText
    }));
  }

  clearTransientRoomState({
    preserveChatDraft = false
  }: {
    preserveChatDraft?: boolean;
  } = {}): void {
    this.update((current) => {
      const nextChatDraft = preserveChatDraft
        ? current.chatDraft || current.chatPendingText || ""
        : "";

      return {
        ...current,
        match: null,
        bombArmed: false,
        chatMessages: [],
        chatDraft: nextChatDraft,
        chatError: null,
        chatPendingText: null
      };
    });
  }

  applyRematchUpdate(players: Array<{ playerId: string; rematchRequested: boolean }>): void {
    this.update((current) => ({
      ...current,
      match: current.match ? mergeRematchState(current.match, players) : current.match
    }));
  }

  private update(nextSnapshot: (current: GameClientSnapshot) => GameClientSnapshot): void {
    const updated = nextSnapshot(this.snapshot);

    if (updated === this.snapshot) {
      return;
    }

    this.snapshot = updated;

    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const createGameClientSnapshot = createInitialSnapshot;
