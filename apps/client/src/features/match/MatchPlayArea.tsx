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
import type { AimedCell } from "../../entities/board/useBoardInput.js";
import { isUsingKeyboard } from "../../lib/browser/last-input.js";
import { ZoomIcon } from "../../shared-ui/ZoomIcon.js";
import { canZoomBoard, readBoardZoomed, writeBoardZoomed } from "./board-zoom-preference.js";
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
  aim: AimedCell | null;
  onAim: (cell: AimedCell) => void;
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
const BOARD_TAP_GUARD_MS = 400;
const TAP_SPOT_PX = 48;
const SAFE_ACTIONS = 'button[name="keep-playing"], button[name="cancel-bomb"]';

// Each press in the action slot swaps the control under the finger, so the next tap of a double
// tap would land on the replacement, which can be Confirm resign. Every press extends the wait,
// so repeated tapping cannot get through. Backing out stays instant, and keyboard and assistive
// technology clicks have detail 0 and pass, because they cannot miss in that way.
const useDoubleTapGuard = () => {
  const lastPress = useRef(Number.NEGATIVE_INFINITY);
  const lastTilePress = useRef({ at: Number.NEGATIVE_INFINITY, x: 0, y: 0 });
  return {
    onBoardPress: (event: MouseEvent<HTMLElement>) => {
      if (event.detail !== 0 && (event.target as Element).closest(".board-cell")) {
        lastTilePress.current = { at: event.timeStamp, x: event.clientX, y: event.clientY };
      }
    },
    onActionPress: (event: MouseEvent<HTMLElement>) => {
      if (event.detail === 0) return;
      // On short windows the action is pinned over the board, so a tile's press can make Fire bomb
      // or a rematch appear under the finger. Nothing is safe here, as Cancel would drop the aim.
      // Each ignored tap extends the wait, so more taps at that spot cannot get through either.
      const tile = lastTilePress.current;
      const sameSpot = Math.hypot(event.clientX - tile.x, event.clientY - tile.y) < TAP_SPOT_PX;
      if (sameSpot && event.timeStamp - tile.at < BOARD_TAP_GUARD_MS) {
        tile.at = event.timeStamp;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const isTooSoon = event.timeStamp - lastPress.current < DOUBLE_TAP_GUARD_MS;
      lastPress.current = event.timeStamp;
      if (isTooSoon && !(event.target as Element).closest(SAFE_ACTIONS)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };
};

const ZoomButton = ({ zoomed, onZoom }: { zoomed: boolean; onZoom: () => void }) => (
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
);

const MatchActions = ({ props, aim }: { props: PlayProps; aim: AimedCell | null }) => {
  if (props.match.phase === "live") {
    return aim || (props.bombArmed && props.view.canAct) ? (
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
          disabled={!aim}
          onClick={() => {
            if (aim) props.onCellSelect(aim.row, aim.column);
          }}
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

const useBoardZoom = () => {
  const [canZoom] = useState(canZoomBoard);
  const [zoomed, setZoomed] = useState(() => canZoom && readBoardZoomed());
  const toggleZoom = () => {
    writeBoardZoomed(!zoomed);
    setZoomed(!zoomed);
  };
  return { canZoom, zoomed, toggleZoom };
};

export const MatchPlayArea = (props: PlayProps) => {
  const playArea = useRef<HTMLElement>(null);
  const guardDoubleTap = useDoubleTapGuard();
  useFocusAcrossPhases(props.match.phase, playArea);
  const { canZoom, zoomed, toggleZoom } = useBoardZoom();
  const [aim, setAim] = useState<AimedCell | null>(null);
  // An aim belongs to one armed turn, so it must not come back when the bomb is armed again.
  if (aim && !(props.bombArmed && props.view.canAct)) setAim(null);
  // Firing clears the armed state before the reply, which would briefly offer the bomb again.
  const [bombFired, setBombFired] = useState(false);
  if (bombFired && props.view.canAct) setBombFired(false);
  const bombInFlight = bombFired && props.view.isOwnTurn;
  const selectCell = (row: number, column: number) => {
    if (props.bombArmed) setBombFired(true);
    props.onCellSelect(row, column);
  };
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
      onClickCapture={guardDoubleTap.onBoardPress}
    >
      <p className="visually-hidden" aria-live="polite">
        {describeLastAction(props.match, props.currentPlayerId)}
      </p>
      <div className="arcade-match-scores">
        {props.view.playerSlots.map((slot) => (
          <PlayerPanel
            key={slot.player.playerId}
            slot={slot}
            match={props.match}
            hidePresence={props.hidePresence ?? false}
            note={slot.isSelf ? undefined : props.solo?.botLevel}
            bombArmed={props.bombArmed || bombInFlight}
            canAct={props.view.isOwnTurn}
            onToggleBomb={() => {
              if (props.view.canAct) props.onToggleBomb();
            }}
          />
        ))}
      </div>
      <MatchBoard
        props={{ ...props, onCellSelect: selectCell }}
        zoomed={zoomed}
        aim={aim}
        onAim={setAim}
      />
      <div className="match-action-slot">
        {props.match.phase === "finished" ? (
          <p className="match-result-line" role="status">
            <MatchResultRibbon
              match={props.match}
              currentPlayerId={props.currentPlayerId}
              playerTones={props.view.playerTones}
            />
          </p>
        ) : null}
        <div className="match-action-row">
          {/* Zoom sits outside the guard: it swaps no control, so it must not delay the next press. */}
          <div className="match-action-main" onClickCapture={guardDoubleTap.onActionPress}>
            <MatchActions props={{ ...props, onCellSelect: selectCell }} aim={aim} />
          </div>
          {canZoom ? <ZoomButton zoomed={zoomed} onZoom={toggleZoom} /> : null}
        </div>
      </div>
    </section>
  );
};
