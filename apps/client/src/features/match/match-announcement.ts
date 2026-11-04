import type { MatchStateDto } from "@minesweeper-flags/shared";

type ResolvedAction = NonNullable<MatchStateDto["lastAction"]>;

const describeOutcome = (action: ResolvedAction, who: string): string => {
  const where = `row ${action.row + 1}, column ${action.column + 1}`;
  switch (action.outcome) {
    case "mine_claimed":
      return `${who} claimed a mine at ${where}.`;
    case "bomb_used":
      return `${who} bombed ${where} and claimed ${action.claimedMineCount} ${
        action.claimedMineCount === 1 ? "mine" : "mines"
      }.`;
    default:
      return `${who} opened ${action.revealedCount} ${
        action.revealedCount === 1 ? "square" : "squares"
      } at ${where}.`;
  }
};

/** The latest move as one sentence, for players who cannot see the board change. */
export const describeLastAction = (match: MatchStateDto, currentPlayerId: string): string => {
  const action = match.lastAction;
  if (!action) return "";

  const nameOf = (player: MatchStateDto["players"][number]) =>
    player.playerId === currentPlayerId ? "You" : player.displayName;
  const mover = match.players.find((player) => player.playerId === action.playerId);
  const score = match.players.map((player) => `${nameOf(player)} ${player.score}`).join(", ");

  return `${describeOutcome(action, mover ? nameOf(mover) : "Opponent")} Score: ${score}.`;
};
