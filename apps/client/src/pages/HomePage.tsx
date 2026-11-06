import "../shared-ui/game-mode.css";

import type { BoardSize } from "@minesweeper-flags/game-engine";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { BoardSizeSelect } from "../shared-ui/BoardSizeSelect.js";
import { GameHelp } from "../shared-ui/GameHelp.js";
import { LobbyLayout } from "../shared-ui/LobbyLayout.js";
import type { SoloDifficulty } from "../solo/bot/bot-profiles.js";
import { SoloDifficultyPicker } from "../solo/SoloDifficultyPicker.js";
import { replaySoloRecord } from "../solo/session/solo-replay.js";
import { soloEntryHref } from "../solo/solo-entry-intent.js";
import {
  readSoloBoardSize,
  readSoloDifficulty,
  writeSoloBoardSize,
  writeSoloDifficulty
} from "../solo/storage/solo-preferences.js";
import { createBrowserSoloStorage } from "../solo/storage/solo-storage.js";

export type Mode = "solo" | "friend";

const modes: { id: Mode; label: string }[] = [
  { id: "solo", label: "Solo" },
  { id: "friend", label: "With a friend" }
];

const FriendPanelActiveContext = createContext(false);

/**
 * True once the player has chosen "With a friend" in this page. The friend form mounts eagerly
 * so the hidden panel reserves its height, but networking must wait for this intent.
 */
export const useFriendPanelActive = () => useContext(FriendPanelActiveContext);

const SoloEntry = () => {
  const [hasLiveGame] = useState(() => {
    const { record } = createBrowserSoloStorage().read();
    return record !== null && replaySoloRecord(record)?.phase === "live";
  });
  const [difficulty, setDifficulty] = useState(readSoloDifficulty);
  const [boardSize, setBoardSize] = useState(readSoloBoardSize);
  const selectDifficulty = (nextDifficulty: SoloDifficulty) => {
    setDifficulty(nextDifficulty);
    writeSoloDifficulty(nextDifficulty);
  };
  const selectBoardSize = (nextBoardSize: BoardSize) => {
    setBoardSize(nextBoardSize);
    writeSoloBoardSize(nextBoardSize);
  };
  const sizeSelect = <BoardSizeSelect value={boardSize} onChange={selectBoardSize} />;
  return (
    <>
      <SoloDifficultyPicker value={difficulty} onChange={selectDifficulty} />
      {hasLiveGame ? (
        <div className="solo-entry-saved">
          <a className="solo-entry-primary" href={soloEntryHref(difficulty, boardSize)}>
            Return to game
          </a>
          {/* The chosen size only applies to a new match, so it sits beside Start new. */}
          <div className="board-size-row">
            {sizeSelect}
            <a
              className="solo-entry-primary solo-entry-new"
              href={soloEntryHref(difficulty, boardSize, true)}
            >
              Start new
            </a>
          </div>
        </div>
      ) : (
        <div className="board-size-row">
          {sizeSelect}
          <a className="solo-entry-primary" href={soloEntryHref(difficulty, boardSize)}>
            Start solo match
          </a>
        </div>
      )}
    </>
  );
};

interface HomePageProps {
  initialMode?: Mode;
  friendContent: ReactNode;
  connectionStatus: string | undefined;
  onFriendSelected: () => void;
  onModeSelected?: (mode: Mode) => void;
}

export const HomePage = ({
  initialMode = "solo",
  friendContent,
  connectionStatus,
  onFriendSelected,
  onModeSelected
}: HomePageProps) => {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [friendVisited, setFriendVisited] = useState(initialMode === "friend");
  // "/" and "/lobby" share this page, so browser history changes the prop without a remount.
  const [routeMode, setRouteMode] = useState(initialMode);
  if (routeMode !== initialMode) {
    setRouteMode(initialMode);
    setMode(initialMode);
    if (initialMode === "friend") setFriendVisited(true);
  }
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ solo: null, friend: null });
  const selectMode = (nextMode: Mode, focus = false) => {
    setMode(nextMode);
    onModeSelected?.(nextMode);
    if (nextMode === "friend") {
      setFriendVisited(true);
      onFriendSelected();
    }
    if (focus) tabs.current[nextMode]?.focus();
  };

  return (
    <LobbyLayout
      connectionStatus={mode === "friend" ? connectionStatus : undefined}
      stage={
        <div className="solo-mode-tabs solo-stage-tabs" role="tablist" aria-label="Game mode">
          {modes.map((item) => (
            <button
              key={item.id}
              id={`${item.id}-tab`}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              aria-controls={`${item.id}-panel`}
              tabIndex={mode === item.id ? 0 : -1}
              ref={(element) => {
                tabs.current[item.id] = element;
              }}
              onClick={() => selectMode(item.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  selectMode(mode === "solo" ? "friend" : "solo", true);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      }
      footer={
        <footer className="arcade-footer">
          <GameHelp />
        </footer>
      }
    >
      <section className="solo-entry-card" aria-label="Choose a game mode">
        {/* Wide layouts reserve both panels' height so switching modes keeps the frame steady. */}
        <div className="solo-entry-panels">
          <div
            id="solo-panel"
            role="tabpanel"
            aria-labelledby="solo-tab"
            hidden={mode !== "solo"}
            inert={mode !== "solo"}
          >
            <SoloEntry />
          </div>
          <div
            id="friend-panel"
            role="tabpanel"
            aria-labelledby="friend-tab"
            hidden={mode !== "friend"}
            inert={mode !== "friend"}
          >
            <FriendPanelActiveContext.Provider value={friendVisited}>
              {friendContent}
            </FriendPanelActiveContext.Provider>
          </div>
        </div>
      </section>
    </LobbyLayout>
  );
};
