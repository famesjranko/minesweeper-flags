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

const coarsePointer = () =>
  typeof window === "undefined" ? undefined : window.matchMedia?.("(pointer: coarse)");

// A mouse can aim at small squares, so only touch screens get zoom. A setting saved on a touch
// screen must not leave a mouse player stuck zoomed with no control to undo it.
export const canZoomBoard = (): boolean => coarsePointer()?.matches === true;

// A hybrid laptop or a browser's device mode can change the input while a match is open.
export const subscribeCanZoomBoard = (onChange: () => void) => {
  const query = coarsePointer();
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
};

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
