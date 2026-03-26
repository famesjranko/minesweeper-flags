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

  if (!currentPlayer) {
    return null;
  }

  return (
    <section className="panel rematch-panel">
      <p>{match.winnerPlayerId ? "Match over." : "Match tied."}</p>
      <p>
        {currentPlayer.rematchRequested
          ? "Waiting for the other player to confirm the rematch."
          : "Ready to queue another round in the same room?"}
      </p>
      <div className="action-row">
        {currentPlayer.rematchRequested ? (
          <button className="secondary-button" onClick={onCancelRematch}>
            Cancel Rematch
          </button>
        ) : (
          <button className="primary-button" onClick={onRequestRematch}>
            Request Rematch
          </button>
        )}
      </div>
    </section>
  );
};

