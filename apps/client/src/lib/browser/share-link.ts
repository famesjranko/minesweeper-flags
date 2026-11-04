export type ShareResult = "shared" | "cancelled" | "failed";

/** True where the browser has a share sheet: most phones, on HTTPS. */
export const canShareLinks = (): boolean =>
  typeof window !== "undefined" && typeof window.navigator.share === "function";

export const shareLink = async (title: string, url: string): Promise<ShareResult> => {
  try {
    await window.navigator.share({ title, url });
    return "shared";
  } catch (error) {
    // Closing the share sheet rejects too, and that is the player's choice, not a failure.
    const isAbort =
      typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
    return isAbort ? "cancelled" : "failed";
  }
};
