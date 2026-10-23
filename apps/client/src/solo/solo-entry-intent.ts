import type { SoloDifficulty } from "./bot/bot-profiles.js";
import { createSoloSession } from "./session/solo-session.js";
import { readSoloDifficulty } from "./storage/solo-difficulty-preference.js";
import {
  createBrowserSoloStorage,
  isSoloDifficulty,
  type SoloStorage
} from "./storage/solo-storage.js";

export const soloEntryHref = (difficulty: SoloDifficulty, startFresh = false): string =>
  `/solo?difficulty=${difficulty}${startFresh ? "&new=1" : ""}`;

const consumeEntryIntent = () => {
  const url = new URL(window.location.href);
  const difficulty = url.searchParams.get("difficulty");
  const startFresh = url.searchParams.get("new") === "1";
  if (url.searchParams.has("difficulty") || url.searchParams.has("new")) {
    url.searchParams.delete("difficulty");
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url);
  }
  return { difficulty: isSoloDifficulty(difficulty) ? difficulty : null, startFresh };
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
    const difficulty = entry.difficulty;
    return createSoloSession({
      storage,
      preferredDifficulty: () => difficulty ?? readSoloDifficulty(),
      startFresh: firstActivation && entry.startFresh
    });
  };
};
