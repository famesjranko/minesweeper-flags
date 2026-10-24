import { getSoundPlayer } from "../features/sound/sound-player.js";
import { setSoundEnabled, useSoundEnabled } from "../features/sound/sound-settings.js";
import { SoundIcon } from "./SoundIcon.js";

export const SoundToggle = () => {
  const enabled = useSoundEnabled();
  const label = enabled ? "Mute sound effects" : "Unmute sound effects";

  const toggle = () => {
    setSoundEnabled(!enabled);
    // Playing inside the click unlocks the browser's AudioContext for later sounds.
    if (!enabled) {
      getSoundPlayer().play("reveal");
    }
  };

  return (
    <button
      type="button"
      className="arcade-sound-button"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      onClick={toggle}
    >
      <SoundIcon enabled={enabled} />
    </button>
  );
};
