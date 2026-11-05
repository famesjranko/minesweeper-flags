import "./match-view.css";
import "./match-controls.css";
import "./match-motion.css";

import { useEffect, useState } from "react";
import {
  advanceLastMoveTrail,
  getLastMoveMarks,
  type LastMoveTrail
} from "../../entities/board/last-move.js";
import { useTurnedOnSinceMount } from "../../entities/board/useTurnedOnSinceMount.js";
import { useChatSounds } from "../sound/useChatSounds.js";
import { useMatchSounds } from "../sound/useMatchSounds.js";
import { MatchChat } from "./MatchChat.js";
import { MatchHeader } from "./MatchHeader.js";
import { MatchPlayArea } from "./MatchPlayArea.js";
import { getMatchPresentation } from "./match-presentation.js";
import type { MatchViewProps } from "./match-view.types.js";
import { useMatchChat } from "./useMatchChat.js";
import { useMatchTitle } from "./useMatchTitle.js";
import { useUnreadChat } from "./useUnreadChat.js";
import { WinBurst } from "./WinBurst.js";

const NO_CHAT: readonly never[] = [];
const SLOW_MOVE_MS = 300;

// A reply normally arrives within moments, so announcing every move would only flicker.
const useSlowMove = (movePending: boolean) => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!movePending) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MOVE_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [movePending]);
  return movePending && slow;
};

export const MatchView = (props: MatchViewProps) => {
  const { match, currentPlayerId } = props;
  // Derive the trail during render so a refresh falls back to lastAction alone
  // and the marks never lag one render behind the snapshot.
  const [storedTrail, setStoredTrail] = useState<LastMoveTrail>([]);
  const lastMoveTrail = advanceLastMoveTrail(storedTrail, match, currentPlayerId);
  if (lastMoveTrail !== storedTrail) setStoredTrail(lastMoveTrail);
  const finishedWhileWatching = useTurnedOnSinceMount(match.phase === "finished");
  const chatMessages = props.presentation === "solo" ? NO_CHAT : props.chatMessages;
  useMatchSounds(match, currentPlayerId);
  useChatSounds(chatMessages, currentPlayerId, match.phase === "live");
  const chatRef = useMatchChat();
  const chat = useUnreadChat(chatMessages, currentPlayerId);
  const moveSlow = useSlowMove(props.presentation !== "solo" && props.movePending === true);
  const view = getMatchPresentation({ ...props, moveSlow });
  useMatchTitle(match, currentPlayerId, view.isOwnTurn);
  const isSolo = props.presentation === "solo";
  const celebrateTone =
    finishedWhileWatching && match.winnerPlayerId === currentPlayerId
      ? view.playerTones[currentPlayerId]
      : undefined;

  return (
    <div className={`arcade-match${isSolo ? " is-solo" : ""}`}>
      <h1 className="visually-hidden">Minesweeper Flags match</h1>
      {!isSolo ? (
        <MatchHeader
          roomCode={props.roomCode}
          match={match}
          opponentOffline={view.opponent?.connected === false}
          connectionStatus={props.connectionStatus}
          unreadChat={chat.unread}
          onOpenChat={() => {
            chat.markRead();
            chatRef.current?.showModal();
          }}
          onBackToLobby={props.onBackToLobby}
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
          onResign={props.onResign}
          resignDisabled={!isSolo && props.connectionStatus !== "connected"}
          solo={props.presentation === "solo" ? { botLevel: props.botLevel } : undefined}
          hidePresence={isSolo}
          celebrateTone={celebrateTone}
        />
        {!isSolo ? (
          <MatchChat
            props={props}
            playerTones={view.playerTones}
            opponent={view.opponent}
            chatRef={chatRef}
            onChatSeen={chat.markRead}
          />
        ) : null}
      </div>
      {celebrateTone ? <WinBurst tone={celebrateTone} /> : null}
    </div>
  );
};
