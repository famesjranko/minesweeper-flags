import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import type { MatchViewProps } from "./match-view.types.js";
import { getPlayerSlots } from "./PlayerPanel.js";

type PresentationInput = Pick<MatchViewProps, "match" | "currentPlayerId" | "bombArmed">;

interface TurnHintInput {
  finished: boolean;
  canAct: boolean;
  bombArmed: boolean;
  canBomb: boolean;
  scoreDeficit: number;
  opponentName: string;
}

const getTurnHint = ({
  finished,
  canAct,
  bombArmed,
  canBomb,
  scoreDeficit,
  opponentName
}: TurnHintInput) => {
  if (finished) return "Match finished";
  if (!canAct) return `${opponentName} is moving.`;
  if (bombArmed) return "Bomb armed. Pick center.";
  if (canBomb) return "Your turn · Bomb ready.";
  if (scoreDeficit > 0 && scoreDeficit < MIN_BOMB_DEFICIT) {
    return `Your turn · Bomb unlocks at down ${MIN_BOMB_DEFICIT}.`;
  }
  return "Your turn · First to 26";
};

export const getMatchPresentation = ({ match, currentPlayerId, bombArmed }: PresentationInput) => {
  const playerSlots = getPlayerSlots(match, currentPlayerId);
  const selfSlot = playerSlots.find((slot) => slot.isSelf);
  const opponent = playerSlots.find((slot) => !slot.isSelf)?.player;
  const canAct = match.phase === "live" && match.currentTurnPlayerId === currentPlayerId;
  const scoreDeficit = selfSlot && opponent ? opponent.score - selfSlot.player.score : 0;
  const canBomb = Boolean(
    selfSlot && opponent && selfSlot.player.bombsRemaining === 1 && scoreDeficit >= MIN_BOMB_DEFICIT
  );
  const [bluePlayer, redPlayer] = match.players;
  const playerTones: Record<string, "blue" | "red"> = {
    [bluePlayer.playerId]: "blue",
    [redPlayer.playerId]: "red"
  };
  const activeTone =
    (match.currentTurnPlayerId ? playerTones[match.currentTurnPlayerId] : undefined) ?? "blue";
  const turnHint = getTurnHint({
    finished: match.phase === "finished",
    canAct,
    bombArmed,
    canBomb,
    scoreDeficit,
    opponentName: opponent?.displayName ?? "Opponent"
  });
  return { playerSlots, selfSlot, opponent, canAct, canBomb, playerTones, activeTone, turnHint };
};

export type MatchPresentation = ReturnType<typeof getMatchPresentation>;
