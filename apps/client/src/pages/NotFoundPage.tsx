import { Link } from "react-router-dom";
import { ArcadePage } from "../shared-ui/ArcadePage.js";

export const NotFoundPage = () => (
  <ArcadePage>
    <section className="arcade-flow is-error">
      <div className="arcade-flow-intro">
        <p className="arcade-flow-eyebrow">Page not found</p>
        <h1>We couldn’t find that page.</h1>
        <p>Check the address, or return to the lobby to start a game.</p>
      </div>
      <div className="arcade-flow-card">
        <Link className="arcade-primary" to="/lobby">
          Back to lobby
        </Link>
      </div>
    </section>
  </ArcadePage>
);
