import type { MatchStateDto } from "@minesweeper-flags/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { getMatchPresentation } from "./match-presentation.js";
import { SoloRacePanel } from "./SoloRacePanel.js";

const match = (mineCount: number, rows: number, scores: [number, number]) =>
  ({
    roomId: "solo",
    phase: "live",
    board: { rows, columns: rows, mineCount, cells: [] },
    players: [
      {
        playerId: "me",
        displayName: "You",
        score: scores[0],
        bombsRemaining: 1,
        connected: true,
        rematchRequested: false
      },
      {
        playerId: "bot",
        displayName: "Bot",
        score: scores[1],
        bombsRemaining: 1,
        connected: true,
        rematchRequested: false
      }
    ],
    currentTurnPlayerId: "me",
    turnPhase: "awaiting_action",
    turnNumber: 1,
    winnerPlayerId: null,
    lastAction: null
  }) as MatchStateDto;

const panel = (state: MatchStateDto) =>
  renderToStaticMarkup(
    <SoloRacePanel
      match={state}
      botLevel="Normal"
      slots={getMatchPresentation({ match: state, currentPlayerId: "me" }).playerSlots}
    />
  );

it.each([
  [79, 20, "Race to 40", "20×20"],
  [115, 24, "Race to 58", "24×24"],
  [179, 30, "Race to 90", "30×30"]
])("names the winning score and board for %i mines", (mines, rows, race, board) => {
  // Given a match on one of the offered boards
  // When the panel renders
  const html = panel(match(mines, rows, [12, 18]));

  // Then it reads the race, the level, both scores and the mines still unclaimed
  expect(html).toContain(race);
  expect(html).toContain("Against the bot · Normal");
  expect(html).toContain("<span>You</span><b>12</b>");
  expect(html).toContain("<span>Bot</span><b>18</b>");
  expect(html).toContain(`<dd>${board}</dd>`);
  expect(html).toContain(`<dd>${mines - 30}</dd>`);
});

it("fills a score bar in proportion to the winning score, and never past it", () => {
  // Given the bot past half the winning score, and a score above it
  // When the panel renders
  const half = panel(match(79, 20, [0, 20]));
  const over = panel(match(79, 20, [0, 50]));

  // Then the bars read half full and completely full
  expect(half).toContain("width:50%");
  expect(over).toContain("width:100%");
});
