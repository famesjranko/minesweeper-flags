const CLAIM_VIBRATION_MS = 25;

/** A short buzz where the browser supports it. iOS Safari does not, and stays silent. */
export const vibrateForClaim = (): void => {
  if (typeof window.navigator.vibrate === "function") {
    window.navigator.vibrate(CLAIM_VIBRATION_MS);
  }
};
