import { Link } from "react-router-dom";
import { DEPLOYMENT_MODE } from "../../lib/config/env.js";
import { ArcadePage } from "../../shared-ui/ArcadePage.js";

export const RoomRestoringPanel = () => (
  <ArcadePage connectionStatus="connecting">
    <section className="arcade-recovery" role="status">
      <span className="arcade-recovery-spinner" aria-hidden="true" />
      <h1>Restoring your game…</h1>
      <p>Reconnecting to your saved seat.</p>
      {/* A direct-match guest can wait here for as long as the host's tab stays closed. */}
      {DEPLOYMENT_MODE === "p2p" ? (
        <p>If the host’s tab has closed, you’ll rejoin when they come back.</p>
      ) : null}
      <Link className="arcade-back" to="/lobby">
        ← Back to lobby
      </Link>
    </section>
  </ArcadePage>
);
