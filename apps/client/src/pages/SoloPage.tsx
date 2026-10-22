import "../solo/solo.css";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MatchView } from "../features/match/MatchView.js";
import { ArcadeHeader } from "../shared-ui/ArcadeHeader.js";
import { createSoloSession, type SoloSession } from "../solo/session/solo-session.js";

interface SoloPageProps {
  createSession?: () => SoloSession;
}

const SoloMatch = ({ session }: { session: SoloSession }) => {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );

  return (
    <main className="page-shell arcade-page-shell arcade-match-page solo-page-shell">
      <div className="solo-match">
        <ArcadeHeader>
          <a className="solo-leave-link" href="/">
            Leave solo match
          </a>
        </ArcadeHeader>
        {snapshot.recoveryNotice ? (
          <p className="solo-notice" role="status">
            {snapshot.recoveryNotice}
          </p>
        ) : null}
        {snapshot.error ? (
          <p className="solo-error" role="alert">
            {snapshot.error}
          </p>
        ) : null}
        <MatchView
          currentPlayerId={snapshot.humanId}
          match={snapshot.match}
          bombArmed={snapshot.bombArmed}
          onToggleBomb={session.toggleBombMode}
          onCellSelect={session.submitCellAction}
          onResign={session.resign}
          presentation="solo"
          botThinking={snapshot.botThinking}
          onRematch={session.rematch}
        />
      </div>
    </main>
  );
};

export const SoloPage = ({ createSession = createSoloSession }: SoloPageProps) => {
  const [session, setSession] = useState<SoloSession | null>(null);

  useEffect(() => {
    const nextSession = createSession();
    nextSession.start();
    setSession(nextSession);
    return () => nextSession.dispose();
  }, [createSession]);

  return session ? <SoloMatch session={session} /> : null;
};
