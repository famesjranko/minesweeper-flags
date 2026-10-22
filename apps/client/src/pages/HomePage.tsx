import "../solo/solo.css";

import { useId, useRef, useState } from "react";
import { ArcadeHeader } from "../shared-ui/ArcadeHeader.js";

type Mode = "solo" | "friend";

const modes: { id: Mode; label: string }[] = [
  { id: "solo", label: "Solo" },
  { id: "friend", label: "With a friend" }
];

export const HomePage = () => {
  const [mode, setMode] = useState<Mode>("solo");
  const labelId = useId();
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ solo: null, friend: null });
  const selectMode = (nextMode: Mode, focus = false) => {
    setMode(nextMode);
    if (focus) tabs.current[nextMode]?.focus();
  };

  return (
    <main className="page-shell arcade-page-shell solo-home-shell">
      <section className="solo-home">
        <ArcadeHeader />
        <div className="solo-home-intro">
          <p className="arcade-eyebrow">A Messenger classic</p>
          <h1>Find the mines. Win the flags.</h1>
          <p>Choose a local match against the bot, or create a room for a friend.</p>
        </div>
        <section className="solo-entry-card" aria-labelledby={labelId}>
          <h2 id={labelId}>How do you want to play?</h2>
          <div className="solo-mode-tabs" role="tablist" aria-label="Game mode">
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
          <div id="solo-panel" role="tabpanel" aria-labelledby="solo-tab" hidden={mode !== "solo"}>
            <p>Play a 16×16 local match. The bot moves from the same revealed clues you see.</p>
            <a className="solo-entry-primary" href="/solo">
              Start solo match
            </a>
          </div>
          <div
            id="friend-panel"
            role="tabpanel"
            aria-labelledby="friend-tab"
            hidden={mode !== "friend"}
          >
            <p>Create or join a room to play on the shared board with a friend.</p>
            <a className="solo-entry-primary" href="/lobby">
              Create or join a room
            </a>
          </div>
        </section>
      </section>
    </main>
  );
};
