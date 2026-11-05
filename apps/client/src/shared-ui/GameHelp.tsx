import "./game-help.css";

import { MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";

export const GameHelp = () => (
  <details className="game-help">
    <summary>How to play</summary>
    <div className="game-help-content">
      <p>
        First to 26 mines wins. Choose a hidden square. A mine scores a point and keeps your turn. A
        safe square ends your turn. Empty areas open automatically.
      </p>
      <p>
        A digit counts mines in the eight surrounding squares, including mines already claimed by
        either player. Use these clues to find the remaining mines.
      </p>
      <p>
        Each player has one comeback bomb. It unlocks when you trail by {MIN_BOMB_DEFICIT} or more.
        It reveals a 5 × 5 area, claims its hidden mines for you, and ends your turn. The preview
        shifts inward at board edges to keep the full area on the board.
      </p>
      <p>
        With a bomb armed, click or tap a hidden square to aim, then choose Fire bomb. Click or tap
        another hidden square to move the aim, or Cancel to disarm.
      </p>
      <p>
        <strong>Keyboard:</strong> Tab enters or leaves the board. Arrow keys move between squares.
        Home and End move to the row’s first and last squares. Enter or Space selects a square and
        fires immediately if a bomb is armed. Escape cancels an armed bomb or closes match options
        and full chat.
      </p>
    </div>
  </details>
);
