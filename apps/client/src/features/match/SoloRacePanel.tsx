import "./solo-race-panel.css";

import { getWinningScore } from "@minesweeper-flags/game-engine";
import type { MatchStateDto } from "@minesweeper-flags/shared";
import type { MatchPresentation } from "./match-presentation.js";

interface SoloRacePanelProps {
  match: MatchStateDto;
  botLevel: string | undefined;
  slots: MatchPresentation["playerSlots"];
}

/** Fills the space chat takes in a room, so Solo keeps the same layout. It cannot grow. */
export const SoloRacePanel = ({ match, botLevel, slots }: SoloRacePanelProps) => {
  const target = getWinningScore(match.board.mineCount);
  const claimed = match.players.reduce((total, player) => total + player.score, 0);
  return (
    <section className="solo-race-panel" aria-label="Match summary">
      <h2>Race to {target}</h2>
      <p className="solo-race-against">Against the bot{botLevel ? ` · ${botLevel}` : ""}</p>
      <div className="solo-race-bars">
        {slots.map((slot) => (
          <div key={slot.player.playerId} className={`solo-race-bar is-${slot.tone}`}>
            <span>{slot.isSelf ? "You" : "Bot"}</span>
            <b>{slot.player.score}</b>
            <i>
              <span style={{ width: `${Math.min(100, (slot.player.score / target) * 100)}%` }} />
            </i>
          </div>
        ))}
      </div>
      <dl>
        <div>
          <dt>Board</dt>
          <dd>
            {match.board.rows}×{match.board.columns}
          </dd>
        </div>
        <div>
          <dt>Mines left</dt>
          <dd>{Math.max(0, match.board.mineCount - claimed)}</dd>
        </div>
      </dl>
    </section>
  );
};
