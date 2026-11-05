import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useRef,
  useState
} from "react";
import { BoardGrid } from "../../entities/board/BoardGrid.js";
import type { LastMoveMarks } from "../../entities/board/last-move.js";
import type { CellPosition } from "../../entities/board/useBoardInput.js";
import { isUsingKeyboard } from "../../lib/browser/last-input.js";
import { ZoomIcon } from "../../shared-ui/ZoomIcon.js";
import { readBoardZoomed, writeBoardZoomed } from "./board-zoom-preference.js";
import { MatchRematchAction, MatchResultRibbon } from "./MatchResultRibbon.js";
import { describeLastAction } from "./match-announcement.js";
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
  solo?: { botLevel?: string | undefined } | undefined;
  hidePresence?: boolean;
  celebrateTone?: "blue" | "red" | undefined;
};

const MatchBoard = ({
  props,
  zoomed,
  aim,
  onAim
}: {
  props: PlayProps;
  zoomed: boolean;
  aim: CellPosition | null;
  onAim: (cell: CellPosition) => void;
}) => {
  const { match, view, bombArmed, lastMove, onCellSelect, celebrateTone } = props;
  const viewportRef = useRef<HTMLElement>(null);
  // Zooming can push the aimed square off the screen while Fire bomb stays live.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a zoom change moves the square, so it must re-run.
  useEffect(() => {
    if (!aim) return;
    viewportRef.current
      ?.querySelector(".board-bomb-preview")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [aim, zoomed]);
  return (
    <div className="arcade-board-stage">
      <section
        ref={viewportRef}
        className={[
          "arcade-board-viewport",
          zoomed ? "is-zoomed" : "",
          celebrateTone ? "is-celebrating" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        tabIndex={zoomed ? 0 : undefined}
        aria-label={zoomed ? "Zoomed board. Scroll to see more squares." : "Game board"}
      >
        <div className="classic-board-frame">
          <BoardGrid
            match={match}
            canAct={view.canAct}
            isOwnTurn={view.isOwnTurn}
            bombArmed={bombArmed}
            playerTones={view.playerTones}
            lastMove={lastMove}
            aimedCell={aim}
            celebrateTone={celebrateTone}
            onSelectCell={onCellSelect}
            onAimCell={onAim}
          />
        </div>
      </section>
    </div>
  );
};

// The control that had focus is about to disappear, so focus returns to the bomb that opened it.
const focusBombButton = (from: HTMLElement) => {
  from
    .closest(".arcade-play-area")
    ?.querySelector<HTMLButtonElement>("button.inline-bomb")
    ?.focus({ preventScroll: true });
};

const DOUBLE_TAP_GUARD_MS = 800;
const SAFE_ACTIONS = 'button[name="keep-playing"], button[name="cancel-bomb"]';

// Each press in the action slot swaps the control under the finger, so the next tap of a double
// tap would land on the replacement, which can be Confirm resign. Every press extends the wait,
// so repeated tapping cannot get through. Backing out stays instant, and keyboard and assistive
// technology clicks have detail 0 and pass, because they cannot miss in that way.
const useDoubleTapGuard = () => {
  const lastPress = useRef(Number.NEGATIVE_INFINITY);
  return (event: MouseEvent<HTMLElement>) => {
    if (event.detail === 0) return;
    const isTooSoon = event.timeStamp - lastPress.current < DOUBLE_TAP_GUARD_MS;
    lastPress.current = event.timeStamp;
    if (isTooSoon && !(event.target as Element).closest(SAFE_ACTIONS)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
};

const MatchTools = ({
  props,
  hint,
  showCancel,
  zoomed,
  onZoom
}: {
  props: PlayProps;
  hint: string;
  showCancel: boolean;
  zoomed: boolean;
  onZoom: () => void;
}) => (
  <div
    className={`arcade-match-status${props.match.phase === "finished" ? " is-result" : ""} is-${props.view.activeTone}`}
  >
    <div
      className="arcade-turn-hint"
      data-turn-hint={
        props.match.phase === "finished" ? undefined : props.view.isOwnTurn ? "YOU" : "OPPONENT"
      }
      role="status"
    >
      {props.match.phase === "finished" ? (
        <MatchResultRibbon
          match={props.match}
          currentPlayerId={props.currentPlayerId}
          playerTones={props.view.playerTones}
        />
      ) : (
        hint
      )}
    </div>
    {showCancel ? (
      <button
        type="button"
        className="arcade-bomb-cancel"
        aria-label="Cancel bomb"
        onClick={(event) => {
          focusBombButton(event.currentTarget);
          props.onToggleBomb();
        }}
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

const MatchActions = ({ props, aim }: { props: PlayProps; aim: CellPosition | null }) => {
  if (props.match.phase === "live") {
    return aim ? (
      <div className="match-resign-confirm">
        <button
          type="button"
          name="cancel-bomb"
          className="match-resign-action"
          onClick={(event) => {
            focusBombButton(event.currentTarget);
            props.onToggleBomb();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          name="fire-bomb"
          className="match-resign-action is-fire"
          onClick={() => props.onCellSelect(aim.row, aim.column)}
        >
          Fire bomb
        </button>
      </div>
    ) : (
      <ResignControl disabled={props.resignDisabled} onResign={props.onResign} />
    );
  }
  return props.solo ? (
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
      blockedReason={props.view.connectionNotice}
      onRequestRematch={props.onRequestRematch}
      onCancelRematch={props.onCancelRematch}
    />
  );
};

const BOARD_TAB_STOP = '[role="grid"] [tabindex="0"]';

// A new phase replaces the control that had focus, such as Confirm resign or Play again, so focus
// moves to what replaced it. A keyboard player arriving at a match, such as from Join game, moves
// too. Nobody else needs that, and it would draw a focus ring on a tile for touch players. A player
// whose focus is elsewhere keeps their place.
const useFocusAcrossPhases = (phase: string, playArea: RefObject<HTMLElement | null>) => {
  const isFirstRender = useRef(true);
  useEffect(() => {
    const justArrived = isFirstRender.current;
    isFirstRender.current = false;
    if (document.activeElement !== document.body) return;
    if (justArrived && !isUsingKeyboard()) return;
    const next = phase === "finished" ? ".match-action-slot button" : BOARD_TAB_STOP;
    playArea.current?.querySelector<HTMLElement>(next)?.focus({ preventScroll: true });
  }, [phase, playArea]);
};

export const MatchPlayArea = (props: PlayProps) => {
  const playArea = useRef<HTMLElement>(null);
  const guardDoubleTap = useDoubleTapGuard();
  useFocusAcrossPhases(props.match.phase, playArea);
  const [zoomed, setZoomed] = useState(readBoardZoomed);
  const [aim, setAim] = useState<CellPosition | null>(null);
  // An aim belongs to one armed turn, so it must not come back when the bomb is armed again.
  if (aim && !(props.bombArmed && props.view.canAct)) setAim(null);
  // A reason applies until the turn moves on or the player does something else.
  const [bombNote, setBombNote] = useState<{ text: string; turnNumber: number } | null>(null);
  const activeNote = bombNote?.turnNumber === props.match.turnNumber ? bombNote.text : null;
  const hint = !props.view.canAct
    ? props.view.turnHint
    : aim
      ? "Bomb aimed. Tap another hidden square to move it."
      : (activeNote ?? props.view.turnHint);
  const disarmOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !props.bombArmed || !props.view.canAct) return;
    focusBombButton(event.currentTarget);
    props.onToggleBomb();
  };

  return (
    <section
      ref={playArea}
      className="arcade-play-area"
      aria-label="Match board and scores"
      onKeyDown={disarmOnEscape}
    >
      <p className="visually-hidden" aria-live="polite">
        {describeLastAction(props.match, props.currentPlayerId)}
      </p>
      <MatchTools
        props={props}
        hint={hint}
        showCancel={props.bombArmed && props.view.canAct && !aim}
        zoomed={zoomed}
        onZoom={() => {
          writeBoardZoomed(!zoomed);
          setZoomed(!zoomed);
        }}
      />
      <div className="arcade-match-scores">
        {props.view.playerSlots.map((slot) => (
          <PlayerPanel
            key={slot.player.playerId}
            slot={slot}
            match={props.match}
            hidePresence={props.hidePresence ?? false}
            note={slot.isSelf ? undefined : props.solo?.botLevel}
            bombArmed={props.bombArmed}
            canAct={props.view.isOwnTurn}
            onToggleBomb={() => {
              if (!props.view.canAct) return;
              setBombNote(null);
              props.onToggleBomb();
            }}
            onExplainBomb={(text) => setBombNote({ text, turnNumber: props.match.turnNumber })}
          />
        ))}
      </div>
      <MatchBoard
        props={{
          ...props,
          onCellSelect: (row, column) => {
            setBombNote(null);
            props.onCellSelect(row, column);
          }
        }}
        zoomed={zoomed}
        aim={aim}
        onAim={setAim}
      />
      <div className="match-action-slot" onClickCapture={guardDoubleTap}>
        <MatchActions props={props} aim={aim} />
      </div>
    </section>
  );
};
