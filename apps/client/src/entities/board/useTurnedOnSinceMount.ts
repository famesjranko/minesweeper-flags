import { useState } from "react";

/**
 * True once `isOn` has turned on while the component is mounted. A condition that was already
 * on at mount stays false until it turns off and on again, so a refresh replays no old moment.
 */
export const useTurnedOnSinceMount = (isOn: boolean): boolean => {
  const [onAtMount, setOnAtMount] = useState(isOn);
  if (onAtMount && !isOn) setOnAtMount(false);
  return isOn && !onAtMount;
};
