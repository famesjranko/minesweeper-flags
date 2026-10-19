import type { ChatMessageDto } from "@minesweeper-flags/shared";
import {
  hasDeliveredChatText,
  reconcileRecoveredChatDraft,
  replaceChatHistory
} from "./game-client.state.js";
import type { GameClientStore } from "./game-client.store.js";

// Keeps a chat message that was in flight when the transport closed. The text goes back
// into the draft, and leaves it again once the server shows the message was delivered.
export class ChatDraftRecovery {
  private recoveredDraftText: string | null = null;

  constructor(private readonly store: GameClientStore) {}

  forget(): void {
    this.recoveredDraftText = null;
  }

  recoverPendingOnClose(): void {
    const pendingText = this.store.getSnapshot().chatPendingText;

    if (pendingText) {
      this.recoveredDraftText = pendingText;
      this.store.setChatDraft(this.store.getSnapshot().chatDraft || pendingText);
      this.store.setChatPendingText(null);
    }
  }

  applyHistory(messages: ChatMessageDto[]): void {
    const snapshot = this.store.getSnapshot();
    const activeSession = snapshot.session;
    const nextMessages = replaceChatHistory(messages);

    this.store.setChatMessages(nextMessages);

    if (
      snapshot.chatPendingText &&
      activeSession &&
      hasDeliveredChatText(nextMessages, activeSession.playerId, snapshot.chatPendingText)
    ) {
      this.store.setChatPendingText(null);
      this.store.setChatError(null);
    }

    const recoveredDraft = reconcileRecoveredChatDraft({
      currentDraft: snapshot.chatDraft,
      recoveredDraftText: this.recoveredDraftText,
      playerId: activeSession?.playerId ?? null,
      messages: nextMessages
    });

    if (recoveredDraft.shouldClearRecoveredDraft) {
      this.recoveredDraftText = null;

      if (recoveredDraft.nextDraft !== snapshot.chatDraft) {
        this.store.setChatDraft(recoveredDraft.nextDraft);
      }
    }
  }

  applyMessage(message: ChatMessageDto): void {
    this.store.appendChatMessage(message);

    if (this.store.getSnapshot().session?.playerId !== message.playerId) {
      return;
    }

    this.store.setChatPendingText(null);
    this.store.setChatError(null);

    if (this.recoveredDraftText === message.text) {
      this.recoveredDraftText = null;

      if (this.store.getSnapshot().chatDraft === message.text) {
        this.store.setChatDraft("");
      }
    }
  }

  rejectPending(errorMessage: string): void {
    const pendingText = this.store.getSnapshot().chatPendingText;

    this.recoveredDraftText = null;

    if (pendingText) {
      this.store.setChatDraft(pendingText);
      this.store.setChatPendingText(null);
    }

    this.store.setChatError(errorMessage);
  }
}
