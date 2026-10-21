import { ArcadePage } from "../../shared-ui/ArcadePage.js";

export const RoomRestoringPanel = () => (
  <ArcadePage connectionStatus="connecting">
    <section className="arcade-recovery" role="status">
      <span className="arcade-recovery-spinner" aria-hidden="true" />
      <h1>Restoring your game…</h1>
      <p>Reconnecting to your saved seat.</p>
    </section>
  </ArcadePage>
);
