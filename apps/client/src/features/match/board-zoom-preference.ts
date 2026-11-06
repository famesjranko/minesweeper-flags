export const BOARD_ZOOM_KEY = "msf:board:zoomed";

const getPreferenceStorage = (): Pick<Storage, "getItem" | "setItem"> | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

// A mouse can aim at small squares, so only touch screens get zoom. A setting saved on a touch
// screen must not leave a mouse player stuck zoomed with no control to undo it.
export const canZoomBoard = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

export const readBoardZoomed = (): boolean => {
  try {
    return getPreferenceStorage()?.getItem(BOARD_ZOOM_KEY) === "on";
  } catch {
    return false;
  }
};

export const writeBoardZoomed = (zoomed: boolean): void => {
  try {
    getPreferenceStorage()?.setItem(BOARD_ZOOM_KEY, zoomed ? "on" : "off");
  } catch {
    // A denied browser storage only loses the remembered choice.
  }
};
