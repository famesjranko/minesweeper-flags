import "./arcade.css";

import type { ReactNode } from "react";
import { FlagIcon } from "./FlagIcon.js";

interface ArcadeHeaderProps {
  connectionStatus?: string | undefined;
  roomCode?: string;
  children?: ReactNode;
}

export const ArcadeHeader = ({ connectionStatus, roomCode, children }: ArcadeHeaderProps) => (
  <header className="arcade-header">
    <div className="arcade-brand">
      <span className="arcade-brand-mark">
        <FlagIcon color="blue" size={26} />
      </span>
      <span>Minesweeper Flags</span>
    </div>
    <div className="arcade-header-actions">
      {roomCode ? <span className="arcade-room-code">Room {roomCode}</span> : null}
      {connectionStatus ? (
        <span className={`arcade-connection is-${connectionStatus}`} role="status">
          {connectionStatus === "connecting" ? "Connecting…" : connectionStatus}
        </span>
      ) : null}
      {children}
    </div>
  </header>
);
