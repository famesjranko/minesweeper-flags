import { getWinningScore } from "@minesweeper-flags/game-engine";
import type { MatchStateDto } from "@minesweeper-flags/shared";
import { describeOfflineOpponent } from "./match-presentation.js";

type Player = MatchStateDto["players"][number];

interface MatchResultRibbonProps {
  match: MatchStateDto;
  currentPlayerId: string;
  playerTones: Record<string, "blue" | "red">;
}

export const getResultTitle = (match: MatchStateDto, currentPlayerId: string): string => {
  const winner = match.players.find((player) => player.playerId === match.winnerPlayerId);

  if (!winner) {
    return "Draw";
  }

  return winner.playerId === currentPlayerId ? "You won" : `${winner.displayName} won`;
};

// The winner's score comes first. A natural win always reaches the board's winning score, so a
// winner short of it won because the other player resigned, even when ahead.
const getScoreLine = (match: MatchStateDto): string => {
  const winner = match.players.find((player) => player.playerId === match.winnerPlayerId);
  const other = match.players.find((player) => player.playerId !== match.winnerPlayerId);

  if (!winner || !other) {
    return match.players.map((player) => player.score).join(" – ");
  }

  const line = `${winner.score} – ${other.score}`;
  return winner.score >= getWinningScore(match.board.mineCount) ? line : `${line} by resignation`;
};

const getRematchState = (currentPlayer: Player, opponent: Player | null) => {
  if (currentPlayer.rematchRequested) {
    return {
      status: `Waiting for ${opponent?.displayName ?? "the other player"}…`,
      label: "Cancel rematch",
      cancels: true
    };
  }

  if (opponent?.rematchRequested) {
    return {
      status: `${opponent.displayName} wants a rematch.`,
      label: "Accept rematch",
      cancels: false
    };
  }

  return { status: null, label: "Request rematch", cancels: false };
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
  /** Why a rematch cannot be sent right now, such as an absent opponent. */
  blockedReason?: string | null;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
};

export const MatchRematchAction = ({
  match,
  currentPlayerId,
  blockedReason = null,
  onRequestRematch,
  onCancelRematch
}: RematchActionProps) => {
  const currentPlayer = match.players.find((player) => player.playerId === currentPlayerId);
  const opponent = match.players.find((player) => player.playerId !== currentPlayerId) ?? null;
  if (!currentPlayer) return null;
  const rematch = getRematchState(currentPlayer, opponent);
  const absentOpponent =
    opponent?.connected === false ? describeOfflineOpponent(opponent.displayName) : null;
  const status = blockedReason ?? absentOpponent ?? rematch.status;
  return (
    <div className="match-rematch-action">
      {status ? <p role="status">{status}</p> : null}
      <button
        type="button"
        className="match-primary-action"
        aria-disabled={blockedReason === null ? undefined : true}
        onClick={() => {
          if (blockedReason !== null) return;
          if (rematch.cancels) onCancelRematch();
          else onRequestRematch();
        }}
      >
        {rematch.label}
      </button>
    </div>
  );
};
