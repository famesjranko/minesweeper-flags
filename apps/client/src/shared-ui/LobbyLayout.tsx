import "./lobby-layout.css";

import type { ReactNode } from "react";
import { ArcadeHeader } from "./ArcadeHeader.js";
import { LobbyBoardHero } from "./LobbyBoardHero.js";

interface LobbyLayoutProps {
  connectionStatus?: string | undefined;
  /** Sits between the heading and the frame, so the frame never carries mode-dependent chrome. */
  stage?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onHome?: () => void;
}

export const LobbyLayout = ({
  connectionStatus,
  stage,
  children,
  footer,
  onHome
}: LobbyLayoutProps) => (
  <main className="page-shell arcade-page-shell solo-home-shell">
    <section className="solo-home">
      <ArcadeHeader connectionStatus={connectionStatus} onHome={onHome} />
      <div className="solo-entry-layout">
        <div className="solo-home-intro">
          <div>
            <h1>
              Find mines. <span>Win flags.</span>
            </h1>
            <p>16×16 board · First to 26 wins</p>
          </div>
          <LobbyBoardHero size="compact" />
        </div>
        {stage}
        <div className="solo-entry-content">
          <LobbyBoardHero />
          {children}
        </div>
      </div>
      {footer}
    </section>
  </main>
);
