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
