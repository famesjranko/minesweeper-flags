import { ChatPanel } from "../chat/ChatPanel.js";
import type { MultiplayerMatchViewProps } from "./match-view.types.js";
import { useMatchChat } from "./useMatchChat.js";
import "./match-chat-preview.css";

export const MatchChat = ({
  props,
  playerTones,
  helperText
}: {
  props: MultiplayerMatchViewProps;
  playerTones: Record<string, "blue" | "red">;
  helperText: string;
}) => {
  const chatRef = useMatchChat();
  const chat = {
    roomCode: props.roomCode,
    currentPlayerId: props.currentPlayerId,
    playerTones,
    connectionStatus: props.connectionStatus,
    messages: props.chatMessages,
    draft: props.chatDraft,
    pending: props.chatPending,
    error: props.chatError,
    onDraftChange: props.onChatDraftChange,
    onSend: props.onSendChatMessage
  };
  return (
    <>
      <div className="arcade-chat-preview">
        <ChatPanel
          {...chat}
          className="arcade-match-chat is-compact"
          onExpand={() => chatRef.current?.showModal()}
        />
      </div>
      <dialog ref={chatRef} className="arcade-chat-region" aria-label="Match chat">
        <ChatPanel
          {...chat}
          helperText={helperText}
          className="arcade-match-chat"
          onClose={() => chatRef.current?.close()}
        />
      </dialog>
    </>
  );
};
