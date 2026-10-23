import "../solo/solo.css";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MatchView } from "../features/match/MatchView.js";
import { ArcadeHeader } from "../shared-ui/ArcadeHeader.js";
import { createSoloSession, type SoloSession } from "../solo/session/solo-session.js";
import { SOLO_DIFFICULTY_COPY } from "../solo/solo-difficulty-options.js";
import { readSoloDifficulty } from "../solo/storage/solo-difficulty-preference.js";

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
          botLevel={SOLO_DIFFICULTY_COPY[snapshot.difficulty].label}
          onRematch={session.rematch}
        />
      </div>
    </main>
  );
};

// A fresh match uses the level last chosen on the home page.
const createPreferredSession = () => {
  const url = new URL(window.location.href);
  const startFresh = url.searchParams.get("new") === "1";
  if (startFresh) {
    // Consume the intent before Strict Mode reactivation or a later refresh can repeat it.
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url);
  }
  return createSoloSession({ preferredDifficulty: readSoloDifficulty, startFresh });
};

export const SoloPage = ({ createSession = createPreferredSession }: SoloPageProps) => {
  const [session, setSession] = useState<SoloSession | null>(null);

  useEffect(() => {
    const nextSession = createSession();
    nextSession.start();
    setSession(nextSession);
    return () => nextSession.dispose();
  }, [createSession]);

  return session ? <SoloMatch session={session} /> : null;
};
