import type { MatchStateDto } from "@minesweeper-flags/shared";
import { useEffect } from "react";
import { getResultTitle } from "./MatchResultRibbon.js";

const APP_TITLE = "Minesweeper Flags";

/** Tells a player in another tab that the game needs them. */
export const useMatchTitle = (
  match: MatchStateDto,
  currentPlayerId: string,
  canAct: boolean
): void => {
  const status =
    match.phase === "finished"
      ? getResultTitle(match, currentPlayerId)
      : canAct
        ? "Your turn"
        : null;

  useEffect(() => {
    document.title = status ? `${status} · ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [status]);
};
