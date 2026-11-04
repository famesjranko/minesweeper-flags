import type { CSSProperties } from "react";
import { FlagIcon } from "../../shared-ui/FlagIcon.js";

const FLAG_COUNT = 28;

// Each flag gets a fixed place in the spread, so a re-render cannot make the burst jump.
const flagStyle = (index: number) =>
  ({
    "--burst-x": `${(index * 61.8) % 96}%`,
    "--burst-delay": `${((index * 0.618) % 1) * 0.45}s`,
    "--burst-spin": `${((index * 137) % 540) - 270}deg`
  }) as CSSProperties;

export const WinBurst = ({ tone }: { tone: "blue" | "red" }) => (
  <div className="win-burst" aria-hidden="true">
    {Array.from({ length: FLAG_COUNT }, (_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: The burst is a fixed list that never reorders.
      <span key={index} className="win-burst-flag" style={flagStyle(index)}>
        <FlagIcon color={tone} size={28} />
      </span>
    ))}
  </div>
);
