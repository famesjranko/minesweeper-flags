let lastInputWasKeyboard = false;

// Registered at load, because the press that matters happens before the view that asks mounts.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => {
    lastInputWasKeyboard = true;
  });
  window.addEventListener("pointerdown", () => {
    lastInputWasKeyboard = false;
  });
}

/** False until a key is pressed in this page load, and again after any pointer press. */
export const isUsingKeyboard = (): boolean => lastInputWasKeyboard;
