import type { MatchStateDto } from "@minesweeper-flags/shared";

type Player = MatchStateDto["players"][number];

interface MatchResultRibbonProps {
  match: MatchStateDto;
  currentPlayerId: string;
  playerTones: Record<string, "blue" | "red">;
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

export const MatchResultRibbon = ({
  match,
  currentPlayerId,
  playerTones
}: MatchResultRibbonProps) => {
  const tone = match.winnerPlayerId ? (playerTones[match.winnerPlayerId] ?? "draw") : "draw";
  return (
    <span className={`match-result-summary is-${tone}`}>
      <strong>{getResultTitle(match, currentPlayerId)}</strong>
      {" · "}
      {getScoreLine(match)}
    </span>
  );
};

type RematchActionProps = Pick<MatchResultRibbonProps, "match" | "currentPlayerId"> & {
  onRequestRematch: () => void;
  onCancelRematch: () => void;
};

export const MatchRematchAction = ({
  match,
  currentPlayerId,
  onRequestRematch,
  onCancelRematch
}: RematchActionProps) => {
  const currentPlayer = match.players.find((player) => player.playerId === currentPlayerId);
  const opponent = match.players.find((player) => player.playerId !== currentPlayerId) ?? null;
  if (!currentPlayer) return null;
  const rematch = getRematchState(currentPlayer, opponent);
  return (
    <div className="match-rematch-action">
      {rematch.status ? <p role="status">{rematch.status}</p> : null}
      <button
        type="button"
        className="match-primary-action"
        onClick={rematch.cancels ? onCancelRematch : onRequestRematch}
      >
        {rematch.label}
      </button>
    </div>
  );
};
