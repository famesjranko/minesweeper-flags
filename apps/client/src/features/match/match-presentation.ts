import { type MatchStateDto, MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";
import type { MatchViewProps } from "./match-view.types.js";
import { getPlayerSlots } from "./PlayerPanel.js";

type PresentationInput = Pick<MatchViewProps, "match" | "currentPlayerId" | "bombArmed"> & {
  connectionStatus?: "disconnected" | "connecting" | "connected";
  movePending?: boolean;
  /** The pending move has outlasted a normal reply, so it is worth saying so. */
  moveSlow?: boolean;
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
  isOwnTurn: boolean;
  bombArmed: boolean;
  canBomb: boolean;
  scoreDeficit: number;
  opponentName: string;
  opponentOffline: boolean;
  connectionNotice: string | null;
  moveSlow: boolean;
}

const getTurnHint = ({
  finished,
  isOwnTurn,
  bombArmed,
  canBomb,
  scoreDeficit,
  opponentName,
  opponentOffline,
  connectionNotice,
  moveSlow
}: TurnHintInput) => {
  if (finished) return "Match finished";
  if (connectionNotice) return connectionNotice;
  if (moveSlow) return "Sending move…";
  if (!isOwnTurn) {
    return opponentOffline ? describeOfflineOpponent(opponentName) : `${opponentName} is moving…`;
  }
  if (bombArmed) return "Bomb armed · choose a square";
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
  movePending = false,
  moveSlow = false
}: PresentationInput) => {
  const playerSlots = getPlayerSlots(match, currentPlayerId).map((slot) =>
    slot.isSelf && connectionStatus !== undefined && connectionStatus !== "connected"
      ? { ...slot, player: { ...slot.player, connected: false } }
      : slot
  );
  const selfSlot = playerSlots.find((slot) => slot.isSelf);
  const opponent = playerSlots.find((slot) => !slot.isSelf)?.player;
  const isOwnTurn =
    match.phase === "live" &&
    match.currentTurnPlayerId === currentPlayerId &&
    (connectionStatus === undefined || connectionStatus === "connected");
  // A pending move blocks input but does not end the turn, so anything that shows whose turn it is
  // reads isOwnTurn. Otherwise each move would flicker, because a reply can keep the turn.
  const canAct = isOwnTurn && !movePending;
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
    isOwnTurn,
    bombArmed,
    canBomb,
    scoreDeficit,
    opponentName: opponent?.displayName ?? "Opponent",
    opponentOffline: opponent?.connected === false,
    connectionNotice,
    moveSlow
  });
  return {
    playerSlots,
    selfSlot,
    opponent,
    isOwnTurn,
    canAct,
    canBomb,
    playerTones,
    activeTone,
    turnHint,
    connectionNotice
  };
};

export type MatchPresentation = ReturnType<typeof getMatchPresentation>;
