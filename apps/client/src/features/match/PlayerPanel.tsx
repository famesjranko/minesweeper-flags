import type { MatchStateDto } from "@minesweeper-flags/shared";
import { CrownIcon } from "../../shared-ui/CrownIcon.js";

export interface PlayerSlot {
  title: "BLUE" | "RED";
  tone: "blue" | "red";
  player: MatchStateDto["players"][number];
  isSelf: boolean;
  isTurn: boolean;
}

// Blue is always the first player and red the second.
export const getPlayerSlots = (
  match: MatchStateDto,
  currentPlayerId: string
): [PlayerSlot, PlayerSlot] => {
  const [bluePlayer, redPlayer] = match.players;

  return [
    {
      title: "BLUE",
      tone: "blue",
      player: bluePlayer,
      isSelf: bluePlayer.playerId === currentPlayerId,
      isTurn: match.currentTurnPlayerId === bluePlayer.playerId
    },
    {
      title: "RED",
      tone: "red",
      player: redPlayer,
      isSelf: redPlayer.playerId === currentPlayerId,
      isTurn: match.currentTurnPlayerId === redPlayer.playerId
    }
  ];
};

interface PlayerPanelProps {
  slot: PlayerSlot;
  match: MatchStateDto;
}

export const PlayerPanel = ({ slot, match }: PlayerPanelProps) => {
  const isWinner = match.phase === "finished" && match.winnerPlayerId === slot.player.playerId;

  return (
    <section
      className={[
        "sidebar-player-panel",
        `sidebar-player-panel-${slot.tone}`,
        slot.isTurn ? "is-turn" : "",
        slot.isSelf ? "is-self" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="arcade-player-identity">
        <header className="sidebar-player-header">
          <span>
            {slot.title} · {slot.isSelf ? "You" : "Opponent"}
          </span>
          <span
            className={`arcade-player-presence${slot.player.connected ? " is-online" : ""}`}
            role="img"
            aria-label={slot.player.connected ? "Connected" : "Disconnected"}
          />
        </header>
        <p className="sidebar-player-name" title={slot.player.displayName}>
          {slot.player.displayName}
        </p>
      </div>
      <div className={`sidebar-score-pill${isWinner ? " is-winner" : ""}`}>
        {isWinner ? <CrownIcon className="winner-crown" /> : null}
        <strong>{slot.player.score}</strong>
      </div>
    </section>
  );
};
