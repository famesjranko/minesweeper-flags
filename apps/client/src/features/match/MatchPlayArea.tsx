import { useState } from "react";
import { BoardGrid } from "../../entities/board/BoardGrid.js";
import type { LastMoveMarks } from "../../entities/board/last-move.js";
import { ZoomIcon } from "../../shared-ui/ZoomIcon.js";
import { MatchResultRibbon } from "./MatchResultRibbon.js";
import type { MatchPresentation } from "./match-presentation.js";
import type { MatchViewProps } from "./match-view.types.js";
import { PlayerBombButton } from "./PlayerBombButton.js";
import { PlayerPanel } from "./PlayerPanel.js";

type PlayProps = Pick<
  MatchViewProps,
  | "match"
  | "currentPlayerId"
  | "bombArmed"
  | "onCellSelect"
  | "onToggleBomb"
  | "onRequestRematch"
  | "onCancelRematch"
> & {
  view: MatchPresentation;
  lastMove: LastMoveMarks;
  chatMessageCount: number;
  onOpenChat: () => void;
};

const MatchBoard = ({ props, zoomed }: { props: PlayProps; zoomed: boolean }) => {
  const {
    match,
    view,
    currentPlayerId,
    bombArmed,
    lastMove,
    onCellSelect,
    onRequestRematch,
    onCancelRematch
  } = props;
  return (
    <div className="arcade-board-stage">
      <section
        className={`arcade-board-viewport${zoomed ? " is-zoomed" : ""}`}
        tabIndex={zoomed ? 0 : undefined}
        aria-label={zoomed ? "Zoomed board. Scroll to see more squares." : "Game board"}
      >
        <div className="classic-board-frame">
          <BoardGrid
            match={match}
            canAct={view.canAct}
            bombArmed={bombArmed}
            playerTones={view.playerTones}
            lastMove={lastMove}
            onSelectCell={onCellSelect}
          />
        </div>
      </section>
      {match.phase === "finished" ? (
        <MatchResultRibbon
          match={match}
          currentPlayerId={currentPlayerId}
          playerTones={view.playerTones}
          onRequestRematch={onRequestRematch}
          onCancelRematch={onCancelRematch}
        />
      ) : null}
    </div>
  );
};

const MatchTools = ({
  props,
  zoomed,
  onZoom
}: {
  props: PlayProps;
  zoomed: boolean;
  onZoom: () => void;
}) => (
  <div className="arcade-match-tools">
    <div
      className={`arcade-turn-hint is-${props.view.activeTone}`}
      data-turn-hint={
        props.match.phase === "finished" ? undefined : props.view.canAct ? "YOU" : "OPPONENT"
      }
      role="status"
    >
      {props.view.turnHint}
    </div>
    <div className="arcade-board-actions">
      {props.view.selfSlot ? (
        <PlayerBombButton
          slot={props.view.selfSlot}
          bombArmed={props.bombArmed}
          canAct={props.view.canAct}
          canBomb={props.view.canBomb}
          finished={props.match.phase === "finished"}
          onToggleBomb={props.onToggleBomb}
        />
      ) : null}
      <button type="button" className="arcade-zoom-button" aria-pressed={zoomed} onClick={onZoom}>
        <ZoomIcon zoomed={zoomed} />
        <span className="arcade-tool-copy">
          <strong>{zoomed ? "Fit board" : "Zoom board"}</strong>
          <small>{zoomed ? "Return to full view" : "Enlarge to 150%"}</small>
        </span>
      </button>
    </div>
  </div>
);

export const MatchPlayArea = (props: PlayProps) => {
  const [zoomed, setZoomed] = useState(false);
  return (
    <section className="arcade-play-area" aria-label="Match board and scores">
      <div className="arcade-match-scores">
        {props.view.playerSlots.map((slot) => (
          <PlayerPanel key={slot.player.playerId} slot={slot} match={props.match} />
        ))}
      </div>
      <MatchBoard props={props} zoomed={zoomed} />
      <MatchTools props={props} zoomed={zoomed} onZoom={() => setZoomed(!zoomed)} />
      <button type="button" className="arcade-chat-toggle" onClick={props.onOpenChat}>
        <span>
          Chat · {props.chatMessageCount} {props.chatMessageCount === 1 ? "message" : "messages"}
        </span>
        <span>Open ↗</span>
      </button>
    </section>
  );
};
