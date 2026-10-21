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
  const isFinished = snapshot.match.phase === "finished";
  const winner = snapshot.match.players.find(
    (player) => player.playerId === snapshot.match.winnerPlayerId
  );
  const loser = snapshot.match.players.find((player) => player.playerId !== winner?.playerId);
  const resultTitle = winner?.playerId === snapshot.humanId ? "You won" : "Bot won";
  const resultScore = winner && loser ? `${winner.score} – ${loser.score}` : "Finished";
  const resigned = winner && loser && winner.score <= loser.score;
  const localStatus = isFinished
    ? "Match finished"
    : snapshot.botThinking
      ? "Bot thinking…"
      : "Your turn";

  return (
    <main className="page-shell arcade-page-shell arcade-match-page solo-page-shell">
      <div className="solo-match">
        <ArcadeHeader>
          <a className="solo-leave-link" href="/">
            Leave solo match
          </a>
        </ArcadeHeader>
        <p className="solo-local-status" role="status">
          Local match · {localStatus}
        </p>
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
          onRematch={session.rematch}
        />
        {isFinished ? (
          <section className="solo-result" role="status" aria-live="polite">
            <p>{resultTitle}</p>
            <strong>
              {resultScore}
              {resigned ? " by resignation" : ""}
            </strong>
          </section>
        ) : null}
        <div className="solo-match-actions">
          {isFinished ? (
            <button type="button" name="rematch" onClick={session.rematch}>
              Play again
            </button>
          ) : (
            <button type="button" name="resign" onClick={session.resign}>
              Resign match
            </button>
          )}
        </div>
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
