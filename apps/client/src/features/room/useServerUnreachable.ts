import { useEffect, useState } from "react";

// Long enough that a normal connection never flashes the notice.
export const SERVER_UNREACHABLE_DELAY_MS = 4_000;

/** True once the watched connection has failed to come up for a while, until it does. */
export const useServerUnreachable = (watching: boolean, connectionStatus: string): boolean => {
  const waiting = watching && connectionStatus !== "connected";
  const [delayPassed, setDelayPassed] = useState(false);

  useEffect(() => {
    setDelayPassed(false);
    if (!waiting) return;
    const timer = setTimeout(() => setDelayPassed(true), SERVER_UNREACHABLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  return waiting && delayPassed;
};
