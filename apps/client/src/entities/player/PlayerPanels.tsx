import type { MatchStateDto } from "@minesweeper-flags/shared";

interface PlayerPanelsProps {
  match: MatchStateDto;
  currentPlayerId: string | null;
}

export const PlayerPanels = ({ match, currentPlayerId }: PlayerPanelsProps) => (
  <div className="player-panels">
    {match.players.map((player) => (
      <article
        key={player.playerId}
        className={[
          "player-card",
          match.currentTurnPlayerId === player.playerId ? "is-turn" : "",
          currentPlayerId === player.playerId ? "is-self" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <header>
          <h2>{player.displayName}</h2>
          <span>{currentPlayerId === player.playerId ? "You" : "Opponent"}</span>
        </header>
        <dl>
          <div>
            <dt>Flags</dt>
            <dd>{player.score}</dd>
          </div>
          <div>
            <dt>Bomb</dt>
            <dd>{player.bombsRemaining ? "Ready" : "Used"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{player.connected ? "Connected" : "Disconnected"}</dd>
          </div>
        </dl>
      </article>
    ))}
  </div>
);

