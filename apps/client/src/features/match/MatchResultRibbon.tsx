import type { MatchStateDto } from "@minesweeper-flags/shared";

type Player = MatchStateDto["players"][number];

interface MatchResultRibbonProps {
  match: MatchStateDto;
  currentPlayerId: string;
  playerTones: Record<string, "blue" | "red">;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
}

const getResultTitle = (match: MatchStateDto, currentPlayerId: string): string => {
  const winner = match.players.find((player) => player.playerId === match.winnerPlayerId);

  if (!winner) {
    return "Draw";
  }

  return winner.playerId === currentPlayerId ? "You won" : `${winner.displayName} won`;
};

// The winner's score comes first. A natural win always leaves the winner ahead, so a winner
// who is not ahead won because the other player resigned.
const getScoreLine = (match: MatchStateDto): string => {
  const winner = match.players.find((player) => player.playerId === match.winnerPlayerId);
  const other = match.players.find((player) => player.playerId !== match.winnerPlayerId);

  if (!winner || !other) {
    return match.players.map((player) => player.score).join(" – ");
  }

  const line = `${winner.score} – ${other.score}`;
  return winner.score > other.score ? line : `${line} by resignation`;
};

const getRematchState = (currentPlayer: Player, opponent: Player | null) => {
  if (currentPlayer.rematchRequested) {
    return {
      status: `Waiting for ${opponent?.displayName ?? "the other player"}…`,
      label: "Cancel Rematch",
      cancels: true
    };
  }

  if (opponent?.rematchRequested) {
    return {
      status: `${opponent.displayName} wants a rematch.`,
      label: "Accept Rematch",
      cancels: false
    };
  }

  return { status: null, label: "Request Rematch", cancels: false };
};

// The result sits over the finished board, in the winner's colour, with the rematch action
// beside it, so the end of a match is stated where the player is already looking.
export const MatchResultRibbon = ({
  match,
  currentPlayerId,
  playerTones,
  onRequestRematch,
  onCancelRematch
}: MatchResultRibbonProps) => {
  const currentPlayer = match.players.find((player) => player.playerId === currentPlayerId);
  const opponent = match.players.find((player) => player.playerId !== currentPlayerId) ?? null;

  if (!currentPlayer) {
    return null;
  }

  const tone = match.winnerPlayerId ? (playerTones[match.winnerPlayerId] ?? "draw") : "draw";
  const score = getScoreLine(match);
  const rematch = getRematchState(currentPlayer, opponent);

  return (
    <div className="match-result-overlay">
      <section className={`match-result-ribbon is-${tone}`} role="status" aria-live="polite">
        <p className="match-result-title">{getResultTitle(match, currentPlayerId)}</p>
        <div className="match-result-row">
          <span className="match-result-score">{score}</span>
          <button
            type="button"
            className="match-result-button"
            onClick={rematch.cancels ? onCancelRematch : onRequestRematch}
          >
            {rematch.label}
          </button>
        </div>
        {rematch.status ? <p className="match-result-status">{rematch.status}</p> : null}
      </section>
    </div>
  );
};
