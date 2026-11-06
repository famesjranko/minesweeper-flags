import { type BoardSize, isOfferedBoardSize } from "@minesweeper-flags/game-engine";
import type { SoloDifficulty } from "./bot/bot-profiles.js";
import { createSoloSession } from "./session/solo-session.js";
import { readSoloBoardSize, readSoloDifficulty } from "./storage/solo-preferences.js";
import {
  createBrowserSoloStorage,
  isSoloDifficulty,
  type SoloStorage
} from "./storage/solo-storage.js";

export const soloEntryHref = (
  difficulty: SoloDifficulty,
  boardSize: BoardSize,
  startFresh = false
): string => `/solo?difficulty=${difficulty}&size=${boardSize}${startFresh ? "&new=1" : ""}`;

const ENTRY_PARAMS = ["difficulty", "size", "new"];

const consumeEntryIntent = () => {
  const url = new URL(window.location.href);
  const difficulty = url.searchParams.get("difficulty");
  const boardSize = url.searchParams.get("size");
  const startFresh = url.searchParams.get("new") === "1";
  if (ENTRY_PARAMS.some((param) => url.searchParams.has(param))) {
    for (const param of ENTRY_PARAMS) url.searchParams.delete(param);
    window.history.replaceState(window.history.state, "", url);
  }
  return {
    difficulty: isSoloDifficulty(difficulty) ? difficulty : null,
    boardSize: isOfferedBoardSize(boardSize) ? boardSize : null,
    startFresh
  };
};

// One page mount owns this handoff. Effect reactivation can recover its replay even
// when durable writes fail; a real reload must read durable storage again.
export const createSoloEntrySessionFactory = () => {
  const durable = createBrowserSoloStorage();
  let current: ReturnType<SoloStorage["read"]> | null = null;
  let entry: ReturnType<typeof consumeEntryIntent> | null = null;
  const storage: SoloStorage = {
    read: () => current ?? durable.read(),
    write: (record) => {
      const notice = durable.write(record);
      current = { record: { ...record, actions: [...record.actions] }, notice };
      return notice;
    },
    clear: () => {
      current = null;
      durable.clear();
    }
  };
  return () => {
    const firstActivation = entry === null;
    entry ??= consumeEntryIntent();
    const { difficulty, boardSize } = entry;
    return createSoloSession({
      storage,
      preferredDifficulty: () => difficulty ?? readSoloDifficulty(),
      preferredBoardSize: () => boardSize ?? readSoloBoardSize(),
      startFresh: firstActivation && entry.startFresh,
      // Links from the home page always name a level, so no level means a reload of this page.
      keepFinished: entry.difficulty === null
    });
  };
};
