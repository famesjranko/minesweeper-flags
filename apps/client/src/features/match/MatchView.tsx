import "./match-view.css";
import "./match-controls.css";

import { useState } from "react";
import {
  advanceLastMoveTrail,
  getLastMoveMarks,
  type LastMoveTrail
} from "../../entities/board/last-move.js";
import { MatchChat } from "./MatchChat.js";
import { MatchHeader } from "./MatchHeader.js";
import { MatchPlayArea } from "./MatchPlayArea.js";
import { getMatchPresentation } from "./match-presentation.js";
import type { MatchViewProps } from "./match-view.types.js";

export const MatchView = (props: MatchViewProps) => {
  const { match, currentPlayerId } = props;
  // Derive the trail during render so a refresh falls back to lastAction alone
  // and the marks never lag one render behind the snapshot.
  const [storedTrail, setStoredTrail] = useState<LastMoveTrail>([]);
  const lastMoveTrail = advanceLastMoveTrail(storedTrail, match, currentPlayerId);
  if (lastMoveTrail !== storedTrail) setStoredTrail(lastMoveTrail);
  const view = getMatchPresentation(props);
  const isSolo = props.presentation === "solo";
  const helperText = view.opponent
    ? `${view.opponent.displayName} is ${view.opponent.connected ? "online" : "offline"}.`
    : "Waiting for the second player to join chat.";

  return (
    <div className={`arcade-match${isSolo ? " is-solo" : ""}`}>
      {!isSolo ? (
        <MatchHeader
          roomCode={props.roomCode}
          match={match}
          connectionStatus={props.connectionStatus}
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
          solo={
            props.presentation === "solo"
              ? { botThinking: props.botThinking ?? false, botLevel: props.botLevel }
              : undefined
          }
          hidePresence={isSolo}
        />
        {!isSolo ? (
          <MatchChat props={props} playerTones={view.playerTones} helperText={helperText} />
        ) : null}
      </div>
    </div>
  );
};
