import { type MatchStateDto, MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import type { MatchViewProps } from "./match-view.types.js";
import { getPlayerSlots } from "./PlayerPanel.js";

type PresentationInput = Pick<MatchViewProps, "match" | "currentPlayerId" | "bombArmed"> & {
  connectionStatus?: "disconnected" | "connecting" | "connected";
  movePending?: boolean;
};

export const describeOfflineOpponent = (name: string): string =>
  `${name} is offline. Waiting for them to return.`;

// Only "connecting" promises a retry: a tab displaced by another tab is "disconnected" and has
// stopped trying. With an absent opponent, "disconnected" is a direct-match host, whose only link
// was that opponent, so the opponent is the real reason.
const getConnectionNotice = (
  connectionStatus: PresentationInput["connectionStatus"],
  opponent: MatchStateDto["players"][number] | undefined
): string | null => {
  if (connectionStatus === "connecting") return "Reconnecting…";
  if (connectionStatus !== "disconnected") return null;
  return opponent?.connected === false
    ? describeOfflineOpponent(opponent.displayName)
    : "Connection lost.";
};

interface TurnHintInput {
  finished: boolean;
  canAct: boolean;
  bombArmed: boolean;
  canBomb: boolean;
  scoreDeficit: number;
  opponentName: string;
  opponentOffline: boolean;
  connectionNotice: string | null;
  movePending: boolean;
}

const getTurnHint = ({
  finished,
  canAct,
  bombArmed,
  canBomb,
  scoreDeficit,
  opponentName,
  opponentOffline,
  connectionNotice,
  movePending
}: TurnHintInput) => {
  if (finished) return "Match finished";
  if (connectionNotice) return connectionNotice;
  if (movePending) return "Sending move…";
  if (!canAct) {
    return opponentOffline ? describeOfflineOpponent(opponentName) : `${opponentName} is moving…`;
  }
  if (bombArmed) return "Bomb armed · tap a square";
  if (canBomb) return "Your turn · Bomb ready.";
  if (scoreDeficit > 0 && scoreDeficit < MIN_BOMB_DEFICIT) {
    return `Your turn · Bomb unlocks when you trail by ${MIN_BOMB_DEFICIT}.`;
  }
  return "Your turn · First to 26";
};

export const getMatchPresentation = ({
  match,
  currentPlayerId,
  bombArmed,
  connectionStatus,
  movePending = false
}: PresentationInput) => {
  const playerSlots = getPlayerSlots(match, currentPlayerId).map((slot) =>
    slot.isSelf && connectionStatus !== undefined && connectionStatus !== "connected"
      ? { ...slot, player: { ...slot.player, connected: false } }
      : slot
  );
  const selfSlot = playerSlots.find((slot) => slot.isSelf);
  const opponent = playerSlots.find((slot) => !slot.isSelf)?.player;
  const canAct =
    !movePending &&
    match.phase === "live" &&
    match.currentTurnPlayerId === currentPlayerId &&
    (connectionStatus === undefined || connectionStatus === "connected");
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
  const connectionNotice = getConnectionNotice(connectionStatus, opponent);
  const turnHint = getTurnHint({
    finished: match.phase === "finished",
    canAct,
    bombArmed,
    canBomb,
    scoreDeficit,
    opponentName: opponent?.displayName ?? "Opponent",
    opponentOffline: opponent?.connected === false,
    connectionNotice,
    movePending
  });
  return {
    playerSlots,
    selfSlot,
    opponent,
    canAct,
    canBomb,
    playerTones,
    activeTone,
    turnHint,
    connectionNotice
  };
};

export type MatchPresentation = ReturnType<typeof getMatchPresentation>;
