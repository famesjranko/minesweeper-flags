import "./solo-difficulty.css";

import type { SoloDifficulty } from "./bot/bot-profiles.js";
import { SOLO_DIFFICULTIES, SOLO_DIFFICULTY_COPY } from "./solo-difficulty-options.js";

interface SoloDifficultyPickerProps {
  value: SoloDifficulty;
  onChange: (difficulty: SoloDifficulty) => void;
}

// Native radios give the segmented control its arrow-key movement and single tab stop.
export const SoloDifficultyPicker = ({ value, onChange }: SoloDifficultyPickerProps) => (
  <div className="solo-difficulty">
    <h2>Play the bot</h2>
    <fieldset
      className="solo-mode-tabs solo-difficulty-options"
      aria-label="Bot level"
      aria-describedby="solo-difficulty-note"
    >
      {SOLO_DIFFICULTIES.map((difficulty) => (
        <label key={difficulty}>
          <input
            type="radio"
            name="solo-difficulty"
            value={difficulty}
            checked={value === difficulty}
            onChange={() => onChange(difficulty)}
          />
          {SOLO_DIFFICULTY_COPY[difficulty].label}
        </label>
      ))}
    </fieldset>
    <p id="solo-difficulty-note" className="solo-difficulty-note">
      {SOLO_DIFFICULTY_COPY[value].description}
    </p>
  </div>
);
