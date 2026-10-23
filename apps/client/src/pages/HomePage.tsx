import "../shared-ui/game-mode.css";

import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { LobbyLayout } from "../shared-ui/LobbyLayout.js";

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

interface HomePageProps {
  initialMode?: Mode;
  friendContent: ReactNode;
  connectionStatus: string;
  onFriendSelected: () => void;
}

export const HomePage = ({
  initialMode = "solo",
  friendContent,
  connectionStatus,
  onFriendSelected
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
          <p>No account needed.</p>
          <details>
            <summary>How to play</summary>
            <p>
              Take turns choosing squares. A mine scores a point and keeps your turn. A safe square
              ends your turn. Your comeback bomb unlocks when you trail by {MIN_BOMB_DEFICIT} or
              more.
            </p>
          </details>
        </footer>
      }
    >
      <section className="solo-entry-card" aria-label="Choose a game mode">
        {/* Both panels share one grid cell so the card keeps the taller panel's height in every mode. */}
        <div className="solo-entry-panels">
          <div
            id="solo-panel"
            role="tabpanel"
            aria-labelledby="solo-tab"
            hidden={mode !== "solo"}
            inert={mode !== "solo"}
          >
            <a className="solo-entry-primary" href="/solo">
              Start solo match
            </a>
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
