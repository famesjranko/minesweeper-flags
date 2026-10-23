import { useState } from "react";
import { BoardGrid } from "../../entities/board/BoardGrid.js";
import type { LastMoveMarks } from "../../entities/board/last-move.js";
import { ZoomIcon } from "../../shared-ui/ZoomIcon.js";
import { MatchRematchAction, MatchResultRibbon } from "./MatchResultRibbon.js";
import type { MatchPresentation } from "./match-presentation.js";
import { PlayerPanel } from "./PlayerPanel.js";
import { ResignControl } from "./ResignControl.js";

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
  onResign: () => void;
  resignDisabled?: boolean;
  solo?: { botThinking: boolean; botLevel?: string | undefined } | undefined;
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
    {props.bombArmed && props.view.canAct ? (
      <button
        type="button"
        className="arcade-bomb-cancel"
        aria-label="Cancel bomb"
        onClick={props.onToggleBomb}
      >
        Cancel
      </button>
    ) : null}
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
            note={slot.isSelf ? undefined : props.solo?.botLevel}
            bombArmed={props.bombArmed}
            canAct={props.view.canAct}
            onToggleBomb={props.onToggleBomb}
          />
        ))}
      </div>
      <MatchBoard props={props} zoomed={zoomed} />
      {props.match.phase === "live" ? (
        <ResignControl disabled={props.resignDisabled} onResign={props.onResign} />
      ) : props.solo ? (
        <button
          type="button"
          name="rematch"
          className="match-primary-action"
          onClick={props.onRequestRematch}
        >
          Play again
        </button>
      ) : (
        <MatchRematchAction
          match={props.match}
          currentPlayerId={props.currentPlayerId}
          onRequestRematch={props.onRequestRematch}
          onCancelRematch={props.onCancelRematch}
        />
      )}
    </section>
  );
};
