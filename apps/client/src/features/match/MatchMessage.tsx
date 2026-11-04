import { useEffect } from "react";
import type { MultiplayerMatchViewProps } from "./match-view.types.js";

const MATCH_MESSAGE_MS = 6_000;

interface MatchMessageProps {
  error: string | null;
  connectionStatus: MultiplayerMatchViewProps["connectionStatus"];
  onExpire: () => void;
}

export const MatchMessage = ({ error, connectionStatus, onExpire }: MatchMessageProps) => {
  // With a live link, an error is a passing message such as a refused move. Without the link
  // it is the only explanation of a lasting state, such as a tab displaced by another.
  const passingError = connectionStatus === "connected" ? error : null;

  useEffect(() => {
    if (!passingError) return;
    const timer = setTimeout(onExpire, MATCH_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [passingError, onExpire]);

  if (!error) return null;

  return (
    <p className={`arcade-match-error${passingError ? "" : " is-lasting"}`} role="alert">
      {error}
    </p>
  );
};
