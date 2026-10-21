import type { ReactNode } from "react";
import { ArcadeHeader } from "./ArcadeHeader.js";

interface ArcadePageProps {
  connectionStatus?: string;
  children: ReactNode;
}

export const ArcadePage = ({ connectionStatus, children }: ArcadePageProps) => (
  <main className="page-shell arcade-page-shell arcade-flow-page">
    <div className="arcade-flow-shell">
      <ArcadeHeader connectionStatus={connectionStatus} />
      {children}
    </div>
  </main>
);
