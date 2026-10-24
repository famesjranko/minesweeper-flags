import type { MatchStateDto } from "@minesweeper-flags/shared";
import { useEffect, useRef } from "react";
import { diffMatchSounds } from "./match-sound-events.js";
import { getSoundPlayer, type SoundPlayer } from "./sound-player.js";
import { isSoundEnabled } from "./sound-settings.js";

export const useMatchSounds = (
  match: MatchStateDto,
  viewerPlayerId: string,
  player: SoundPlayer = getSoundPlayer()
): void => {
  const previousRef = useRef<MatchStateDto | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new snapshot should sound
  useEffect(() => {
    const names = diffMatchSounds(previousRef.current, match, viewerPlayerId);
    previousRef.current = match;
    if (!isSoundEnabled()) {
      return;
    }
    for (const name of names) {
      player.play(name);
    }
  }, [match]);
};
