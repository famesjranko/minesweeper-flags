// navigator.clipboard exists only on HTTPS and localhost, so a self-hosted plain-HTTP game
// copies through the older selection command.
const copyWithSelection = (value: string): boolean => {
  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.focus({ preventScroll: true });
  field.select();
  field.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  field.remove();
  if (previousFocus instanceof HTMLElement) previousFocus.focus();
  return copied;
};

/** Copies the text and reports whether it worked. It never rejects. */
export const copyText = async (value: string): Promise<boolean> => {
  try {
    if (window.navigator.clipboard) {
      await window.navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // A denied clipboard permission can still allow the selection command.
  }

  try {
    return copyWithSelection(value);
  } catch {
    return false;
  }
};
