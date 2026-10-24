import "./arcade.css";

import type { ReactNode } from "react";
import { FlagIcon } from "./FlagIcon.js";
import { SoundToggle } from "./SoundToggle.js";

interface ArcadeHeaderProps {
  connectionStatus?: string | undefined;
  roomCode?: string;
  onHome?: (() => void) | undefined;
  children?: ReactNode;
}

export const ArcadeHeader = ({
  connectionStatus,
  roomCode,
  onHome,
  children
}: ArcadeHeaderProps) => (
  <header className="arcade-header">
    <a
      className="arcade-brand"
      href="/"
      aria-label="Minesweeper Flags — game selection"
      onClick={
        onHome
          ? (event) => {
              event.preventDefault();
              onHome();
            }
          : undefined
      }
    >
      <span className="arcade-brand-mark">
        <FlagIcon color="blue" size={26} />
      </span>
      <span>Minesweeper Flags</span>
    </a>
    <div className="arcade-header-actions">
      {roomCode ? <span className="arcade-room-code">Room {roomCode}</span> : null}
      {connectionStatus ? (
        <span className={`arcade-connection is-${connectionStatus}`} role="status">
          {connectionStatus === "connecting" ? "Connecting…" : connectionStatus}
        </span>
      ) : null}
      {children}
      <SoundToggle />
    </div>
  </header>
);
