import type { MatchStateDto } from "@minesweeper-flags/shared";
import type { RefObject } from "react";
import { ChatPanel } from "../chat/ChatPanel.js";
import type { MultiplayerMatchViewProps } from "./match-view.types.js";
import "./match-chat-preview.css";

export const MatchChat = ({
  props,
  playerTones,
  opponent,
  chatRef,
  onChatSeen
}: {
  props: MultiplayerMatchViewProps;
  playerTones: Record<string, "blue" | "red">;
  opponent: MatchStateDto["players"][number] | undefined;
  chatRef: RefObject<HTMLDialogElement | null>;
  onChatSeen: () => void;
}) => {
  const helperText = opponent
    ? `${opponent.displayName} is ${opponent.connected ? "online" : "offline"}.`
    : "Waiting for the second player to join chat.";
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
    onSend: () => {
      onChatSeen();
      props.onSendChatMessage();
    }
  };
  return (
    <>
      <div className="arcade-chat-preview">
        <ChatPanel
          {...chat}
          className="arcade-match-chat is-compact"
          onExpand={() => {
            onChatSeen();
            chatRef.current?.showModal();
          }}
        />
      </div>
      <dialog
        ref={chatRef}
        className="arcade-chat-region"
        aria-label="Match chat"
        onClose={(event) => {
          onChatSeen();
          // If the browser could not restore focus, return to the preview's open control.
          const focused = document.activeElement;
          if (focused === document.body || event.currentTarget.contains(focused)) {
            event.currentTarget
              .closest(".arcade-match")
              ?.querySelector<HTMLButtonElement>(".chat-expand")
              ?.focus({ preventScroll: true });
          }
        }}
      >
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
