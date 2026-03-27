import type { MatchStateDto } from "@minesweeper-flags/shared";

interface RematchPanelProps {
  match: MatchStateDto;
  currentPlayerId: string;
  onRequestRematch: () => void;
  onCancelRematch: () => void;
}

export const RematchPanel = ({
  match,
  currentPlayerId,
  onRequestRematch,
  onCancelRematch
}: RematchPanelProps) => {
  const currentPlayer = match.players.find((player) => player.playerId === currentPlayerId);
  const opponent = match.players.find((player) => player.playerId !== currentPlayerId) ?? null;

  if (!currentPlayer) {
    return null;
  }

  const isWaitingForOpponent = currentPlayer.rematchRequested;
  const isOpponentWaiting = !currentPlayer.rematchRequested && Boolean(opponent?.rematchRequested);
  const rematchMessage = isWaitingForOpponent
    ? "Waiting for the other player to confirm the rematch."
    : isOpponentWaiting
      ? "The other player requested a rematch. Confirm to start the next round."
      : "Ready to queue another round in the same room?";
  const rematchActionLabel = isWaitingForOpponent
    ? "Cancel Rematch"
    : isOpponentWaiting
      ? "Accept Rematch"
      : "Request Rematch";

  return (
    <section className="panel rematch-panel">
      <p>{match.winnerPlayerId ? "Match over." : "Match tied."}</p>
      <p>{rematchMessage}</p>
      <div className="action-row">
        {isWaitingForOpponent ? (
          <button className="secondary-button" onClick={onCancelRematch}>
            {rematchActionLabel}
          </button>
        ) : (
          <button className="primary-button" onClick={onRequestRematch}>
            {rematchActionLabel}
          </button>
        )}
      </div>
    </section>
  );
};
