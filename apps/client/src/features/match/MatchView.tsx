import "./match-view.css";

import { useState } from "react";
import {
  advanceLastMoveTrail,
  getLastMoveMarks,
  type LastMoveTrail
} from "../../entities/board/last-move.js";
import { ChatPanel } from "../chat/ChatPanel.js";
import { MatchHeader } from "./MatchHeader.js";
import { MatchPlayArea } from "./MatchPlayArea.js";
import { getMatchPresentation } from "./match-presentation.js";
import type { MatchViewProps } from "./match-view.types.js";
import { useMatchChat } from "./useMatchChat.js";

export const MatchView = (props: MatchViewProps) => {
  const { match, currentPlayerId } = props;
  // Derive the trail during render so a refresh falls back to lastAction alone
  // and the marks never lag one render behind the snapshot.
  const [storedTrail, setStoredTrail] = useState<LastMoveTrail>([]);
  const lastMoveTrail = advanceLastMoveTrail(storedTrail, match, currentPlayerId);
  if (lastMoveTrail !== storedTrail) setStoredTrail(lastMoveTrail);
  const view = getMatchPresentation(props);
  const chatRef = useMatchChat();
  const isSolo = props.presentation === "solo";
  const helperText = view.opponent
    ? `${view.opponent.displayName} is ${view.opponent.connected ? "online" : "offline"}.`
    : "Waiting for the second player to join chat.";

  return (
    <div className="arcade-match">
      {!isSolo ? (
        <MatchHeader
          roomCode={props.roomCode}
          match={match}
          connectionStatus={props.connectionStatus}
          onResign={props.onResign}
        />
      ) : null}
      <div className="arcade-match-main">
        <MatchPlayArea
          match={match}
          currentPlayerId={currentPlayerId}
          bombArmed={props.bombArmed}
          onCellSelect={props.onCellSelect}
          onToggleBomb={props.onToggleBomb}
          onRequestRematch={isSolo ? props.onRematch : props.onRequestRematch}
          onCancelRematch={isSolo ? () => {} : props.onCancelRematch}
          view={view}
          lastMove={getLastMoveMarks(
            lastMoveTrail,
            match.board.rows,
            match.board.columns,
            view.playerTones
          )}
          chatMessageCount={isSolo ? 0 : props.chatMessages.length}
          onOpenChat={() => chatRef.current?.showModal()}
          showChat={!isSolo}
          showResultRibbon={!isSolo}
          hidePresence={isSolo}
        />
        {!isSolo ? (
          <dialog ref={chatRef} className="arcade-chat-region" aria-label="Match chat">
            <ChatPanel
              roomCode={props.roomCode}
              currentPlayerId={currentPlayerId}
              playerTones={view.playerTones}
              connectionStatus={props.connectionStatus}
              messages={props.chatMessages}
              draft={props.chatDraft}
              pending={props.chatPending}
              error={props.chatError}
              helperText={helperText}
              className="arcade-match-chat"
              onClose={() => chatRef.current?.close()}
              onDraftChange={props.onChatDraftChange}
              onSend={props.onSendChatMessage}
            />
          </dialog>
        ) : null}
      </div>
    </div>
  );
};
