import { getBombDeficit, type MatchStateDto } from "@minesweeper-flags/shared";
import type { MatchViewProps } from "./match-view.types.js";
import { getPlayerSlots } from "./PlayerPanel.js";

type PresentationInput = Pick<MatchViewProps, "match" | "currentPlayerId"> & {
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

export const getMatchPresentation = ({
  match,
  currentPlayerId,
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
  const isOwnTurn =
    match.phase === "live" &&
    match.currentTurnPlayerId === currentPlayerId &&
    (connectionStatus === undefined || connectionStatus === "connected");
  // A pending move blocks input but does not end the turn, so anything that shows whose turn it is
  // reads isOwnTurn. Otherwise each move would flicker, because a reply can keep the turn.
  const canAct = isOwnTurn && !movePending;
  const scoreDeficit = selfSlot && opponent ? opponent.score - selfSlot.player.score : 0;
  const bombDeficit = getBombDeficit(match.board.mineCount);
  const canBomb = Boolean(
    selfSlot && opponent && selfSlot.player.bombsRemaining === 1 && scoreDeficit >= bombDeficit
  );
  const [bluePlayer, redPlayer] = match.players;
  const playerTones: Record<string, "blue" | "red"> = {
    [bluePlayer.playerId]: "blue",
    [redPlayer.playerId]: "red"
  };
  const connectionNotice = getConnectionNotice(connectionStatus, opponent);
  return {
    playerSlots,
    selfSlot,
    opponent,
    isOwnTurn,
    canAct,
    canBomb,
    playerTones,
    connectionNotice
  };
};

export type MatchPresentation = ReturnType<typeof getMatchPresentation>;
