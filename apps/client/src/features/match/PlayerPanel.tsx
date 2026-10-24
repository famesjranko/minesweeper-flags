import { getBombDeficit, type MatchStateDto } from "@minesweeper-flags/shared";
import { useState } from "react";
import { CrownIcon } from "../../shared-ui/CrownIcon.js";
import { PlayerBombButton } from "./PlayerBombButton.js";

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
  hidePresence?: boolean;
  /** A short tag after the colour, such as the bot's level. */
  note?: string | undefined;
  bombArmed: boolean;
  canAct: boolean;
  onToggleBomb: () => void;
}

// The key restarts the bump for each point. The first score shown is history, so it stays still.
const ScoreValue = ({ score }: { score: number }) => {
  const [firstScore] = useState(score);
  return (
    <strong key={score} className={score === firstScore ? undefined : "is-bump"}>
      {score}
    </strong>
  );
};

const describeSlot = (slot: PlayerSlot, note: string | undefined, hidePresence: boolean) => {
  const tag = slot.isSelf ? "You" : note;
  const offline = !hidePresence && !slot.player.connected;
  return {
    offline,
    header: offline ? "Offline" : tag ? `${slot.title} · ${tag}` : slot.title,
    // A solo human is already named "You", so the name would only repeat the role.
    region: [...new Set([slot.title, slot.isSelf ? "You" : "Opponent", slot.player.displayName])]
      .concat(note ?? [])
      .join(" · ")
  };
};

export const PlayerPanel = ({
  slot,
  match,
  hidePresence = false,
  note,
  ...bomb
}: PlayerPanelProps) => {
  const opponent = match.players.find((player) => player.playerId !== slot.player.playerId);
  const bombDeficit = getBombDeficit(match.board.mineCount);
  const canBomb = Boolean(opponent && opponent.score - slot.player.score >= bombDeficit);
  const isWinner = match.phase === "finished" && match.winnerPlayerId === slot.player.playerId;
  const labels = describeSlot(slot, note, hidePresence);

  return (
    <section
      aria-label={labels.region}
      className={[
        "sidebar-player-panel",
        `sidebar-player-panel-${slot.tone}`,
        slot.isTurn && match.phase === "live" ? "is-turn" : "",
        isWinner ? "is-card-winner" : "",
        slot.isSelf ? "is-self" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="sidebar-player-name" title={slot.player.displayName}>
        <span className="player-name-text">{slot.player.displayName}</span>
        <span className="player-crown-slot">
          {isWinner ? <CrownIcon className="winner-crown" /> : null}
        </span>
      </p>
      <header className="sidebar-player-header">
        <span className={labels.offline ? "is-offline" : undefined}>{labels.header}</span>
        {!hidePresence ? (
          <span
            className={`arcade-player-presence${slot.player.connected ? " is-online" : ""}`}
            role="img"
            aria-label={slot.player.connected ? "Connected" : "Disconnected"}
          />
        ) : null}
      </header>
      <div className="card-inline-actions">
        <div className={`sidebar-score-pill${isWinner ? " is-winner" : ""}`}>
          <ScoreValue score={slot.player.score} />
        </div>
        <PlayerBombButton
          {...bomb}
          slot={slot}
          canBomb={canBomb}
          bombDeficit={bombDeficit}
          finished={match.phase === "finished"}
        />
      </div>
    </section>
  );
};
