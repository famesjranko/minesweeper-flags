import type { ChatMessageDto, MatchStateDto } from "@minesweeper-flags/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface CommonMatchViewProps {
  currentPlayerId: string;
  match: MatchStateDto;
  bombArmed: boolean;
  onToggleBomb: () => void;
  onCellSelect: (row: number, column: number) => void;
  onResign: () => void;
}

export interface MultiplayerMatchViewProps extends CommonMatchViewProps {
  presentation?: "multiplayer";
  roomCode: string;
  connectionStatus: ConnectionStatus;
  chatMessages: ChatMessageDto[];
  chatError: string | null;
  chatDraft: string;
  chatPending: boolean;
  onChatDraftChange: (value: string) => void;
  onSendChatMessage: () => void;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
}

export interface SoloMatchViewProps extends CommonMatchViewProps {
  presentation: "solo";
  onRematch: () => void;
  botThinking?: boolean;
}

export type MatchViewProps = MultiplayerMatchViewProps | SoloMatchViewProps;
