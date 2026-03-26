import type { ReactNode } from "react";

const previewCells = [
  "hidden",
  "number-1",
  "flag-blue",
  "number-1",
  "hidden",
  "hidden",
  "hidden",
  "number-2",
  "number-2",
  "number-2",
  "hidden",
  "flag-red",
  "hidden",
  "number-1",
  "revealed",
  "number-3",
  "flag-blue",
  "hidden",
  "hidden",
  "hidden",
  "number-1",
  "number-2",
  "hidden",
  "hidden",
  "hidden",
  "flag-red",
  "hidden",
  "number-1",
  "number-1",
  "hidden",
  "number-2",
  "number-3",
  "flag-blue",
  "hidden",
  "number-2",
  "revealed"
] as const;

interface LobbyPreviewPanelProps {
  title: string;
  badge: string;
  featurePills?: string[];
  details?: ReactNode;
}

export const LobbyPreviewPanel = ({
  title,
  badge,
  featurePills = [],
  details
}: LobbyPreviewPanelProps) => (
  <section className="lobby-preview-card">
    <div className="lobby-preview-header">
      <span className="lobby-preview-title">{title}</span>
      <span className="lobby-preview-badge">{badge}</span>
    </div>

    <div className="lobby-preview-window">
      <aside className="lobby-preview-sidebar">
        <div className="lobby-preview-sidebar-panel is-blue">
          <strong>BLUE</strong>
          <span>18 flags</span>
        </div>
        <div className="lobby-preview-sidebar-panel is-red">
          <strong>RED</strong>
          <span>18 flags</span>
        </div>
      </aside>

      <div className="lobby-preview-board">
        {previewCells.map((cell, index) => (
          <div
            key={`${cell}-${index}`}
            className={["lobby-preview-cell", `is-${cell}`].join(" ")}
          >
            {cell === "number-1" ? "1" : cell === "number-2" ? "2" : cell === "number-3" ? "3" : ""}
            {cell === "flag-blue" ? "⚑" : ""}
            {cell === "flag-red" ? "⚐" : ""}
          </div>
        ))}
      </div>
    </div>

    {details}

    {featurePills.length ? (
      <div className="lobby-feature-row">
        {featurePills.map((pill) => (
          <div key={pill} className="lobby-feature-pill">
            {pill}
          </div>
        ))}
      </div>
    ) : null}
  </section>
);
