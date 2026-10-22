import { useState } from "react";
import { BoardGrid } from "../../entities/board/BoardGrid.js";
import type { LastMoveMarks } from "../../entities/board/last-move.js";
import { ZoomIcon } from "../../shared-ui/ZoomIcon.js";
import { MatchRematchAction, MatchResultRibbon } from "./MatchResultRibbon.js";
import type { MatchPresentation } from "./match-presentation.js";
import { PlayerPanel } from "./PlayerPanel.js";

type PlayProps = {
  match: import("@minesweeper-flags/shared").MatchStateDto;
  currentPlayerId: string;
  bombArmed: boolean;
  onCellSelect: (row: number, column: number) => void;
  onToggleBomb: () => void;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
  view: MatchPresentation;
  lastMove: LastMoveMarks;
  chatMessageCount: number;
  onOpenChat: () => void;
  showChat?: boolean;
  solo?: { botThinking: boolean; onResign: () => void } | undefined;
  hidePresence?: boolean;
};

const MatchBoard = ({ props, zoomed }: { props: PlayProps; zoomed: boolean }) => {
  const { match, view, bombArmed, lastMove, onCellSelect } = props;
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
  <div
    className={`arcade-match-status${props.match.phase === "finished" ? " is-result" : ""} is-${props.view.activeTone}`}
  >
    <div
      className="arcade-turn-hint"
      data-turn-hint={
        props.match.phase === "finished" ? undefined : props.view.canAct ? "YOU" : "OPPONENT"
      }
      role="status"
    >
      {props.match.phase === "finished" ? (
        <MatchResultRibbon
          match={props.match}
          currentPlayerId={props.currentPlayerId}
          playerTones={props.view.playerTones}
        />
      ) : props.solo?.botThinking ? (
        "Bot thinking…"
      ) : (
        props.view.turnHint
      )}
    </div>
    <button
      type="button"
      className="arcade-zoom-button"
      aria-label={zoomed ? "Fit board" : "Expand board to 150%"}
      title={zoomed ? "Fit board" : "Expand board to 150%"}
      aria-pressed={zoomed}
      onClick={onZoom}
    >
      <ZoomIcon zoomed={zoomed} />
    </button>
  </div>
);

export const MatchPlayArea = (props: PlayProps) => {
  const [zoomed, setZoomed] = useState(false);
  return (
    <section className="arcade-play-area" aria-label="Match board and scores">
      <MatchTools props={props} zoomed={zoomed} onZoom={() => setZoomed(!zoomed)} />
      <div className="arcade-match-scores">
        {props.view.playerSlots.map((slot) => (
          <PlayerPanel
            key={slot.player.playerId}
            slot={slot}
            match={props.match}
            hidePresence={props.hidePresence ?? false}
            bombArmed={props.bombArmed}
            canAct={props.view.canAct}
            onToggleBomb={props.onToggleBomb}
          />
        ))}
      </div>
      <MatchBoard props={props} zoomed={zoomed} />
      {props.solo ? (
        <button
          type="button"
          name={props.match.phase === "finished" ? "rematch" : "resign"}
          className={
            props.match.phase === "finished" ? "match-primary-action" : "match-resign-action"
          }
          onClick={props.match.phase === "finished" ? props.onRequestRematch : props.solo.onResign}
        >
          {props.match.phase === "finished" ? "Play again" : "Resign match"}
        </button>
      ) : props.match.phase === "finished" ? (
        <MatchRematchAction
          match={props.match}
          currentPlayerId={props.currentPlayerId}
          onRequestRematch={props.onRequestRematch}
          onCancelRematch={props.onCancelRematch}
        />
      ) : null}
      {props.showChat !== false ? (
        <button type="button" className="arcade-chat-toggle" onClick={props.onOpenChat}>
          <span>
            Chat · {props.chatMessageCount} {props.chatMessageCount === 1 ? "message" : "messages"}
          </span>
          <span>Open ↗</span>
        </button>
      ) : null}
    </section>
  );
};
