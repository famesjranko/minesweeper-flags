import "./room-recovery.css";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export const RECOVERY_GUIDANCE_DELAY_MS = 15_000;

interface RoomRecoveryNoticeProps {
  waiting: boolean;
  displaced?: boolean;
  isP2PDeployment: boolean;
  onReconnect?: () => void;
  onReload?: () => void;
}

export const RoomRecoveryNotice = ({
  waiting,
  displaced = false,
  isP2PDeployment,
  onReconnect,
  onReload = () => window.location.reload()
}: RoomRecoveryNoticeProps) => {
  const [delayPassed, setDelayPassed] = useState(false);
  useEffect(() => {
    setDelayPassed(false);
    if (!waiting) return;
    const timer = setTimeout(() => setDelayPassed(true), RECOVERY_GUIDANCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  if (!displaced && !(waiting && delayPassed)) return null;

  return (
    <aside className="arcade-recovery-notice" aria-label="Connection help">
      <div role="status">
        <strong>{displaced ? "Game active in another tab" : "Taking longer than usual"}</strong>
        {displaced ? (
          <p>Use the other tab, or reconnect here to take control of this game.</p>
        ) : (
          <>
            <p>We’re still trying. Check your internet connection. You can keep waiting here.</p>
            {isP2PDeployment ? <p>Ask your friend to keep their game tab open.</p> : null}
          </>
        )}
      </div>
      <div className="arcade-flow-actions">
        <button
          type="button"
          className="arcade-primary"
          onClick={displaced ? onReconnect : onReload}
        >
          {displaced ? "Reconnect here" : "Reload and reconnect"}
        </button>
        <Link className="arcade-secondary" to="/lobby">
          Back to lobby
        </Link>
      </div>
    </aside>
  );
};
