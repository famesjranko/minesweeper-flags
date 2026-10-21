import type { ChatMessageDto, MatchStateDto } from "@minesweeper-flags/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface MatchViewProps {
  roomCode: string;
  currentPlayerId: string;
  match: MatchStateDto;
  bombArmed: boolean;
  connectionStatus: ConnectionStatus;
  chatMessages: ChatMessageDto[];
  chatError: string | null;
  chatDraft: string;
  chatPending: boolean;
  onToggleBomb: () => void;
  onCellSelect: (row: number, column: number) => void;
  onChatDraftChange: (value: string) => void;
  onSendChatMessage: () => void;
  onResign: () => void;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
  presentation?: "multiplayer" | "solo";
}
