interface BombIconProps {
  variant?: "idle" | "ready" | "armed" | "spent";
  className?: string;
  size?: number;
}

const PALETTE = {
  idle: {
    shell: "#2f3743",
    shellShadow: "#141920",
    shellHighlight: "#5a6575",
    fuse: "#5f472f",
    spark: "#d9a13b",
    accent: "#f7ecd4"
  },
  ready: {
    shell: "#423427",
    shellShadow: "#1e1711",
    shellHighlight: "#8a6a4f",
    fuse: "#774d19",
    spark: "#ffbf45",
    accent: "#fff4d9"
  },
  armed: {
    shell: "#4c2417",
    shellShadow: "#240d08",
    shellHighlight: "#a8552e",
    fuse: "#7f2d14",
    spark: "#ffd27a",
    accent: "#fff2cf"
  },
  spent: {
    shell: "#5b626d",
    shellShadow: "#2d3138",
    shellHighlight: "#9299a4",
    fuse: "#4a5058",
    spark: "#bcc3cc",
    accent: "#e4e7eb"
  }
} as const;

export const BombIcon = ({ variant = "idle", className, size = 18 }: BombIconProps) => {
  const palette = PALETTE[variant];

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      <path
        d="M13.4 3.8C14.1 2.8 15.1 2.2 16.3 2.2C17.5 2.2 18.4 2.7 19.1 3.6"
        fill="none"
        stroke={palette.fuse}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M18.9 3.2L20.4 1.7M20.1 4.7H22M18.9 6.1L20.4 7.6"
        fill="none"
        stroke={palette.spark}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <rect
        x="10.7"
        y="4.1"
        width="5.1"
        height="3.1"
        rx="1.2"
        fill={palette.fuse}
        transform="rotate(28 13.25 5.65)"
      />
      <circle cx="10.7" cy="13.2" r="6.4" fill={palette.shellShadow} />
      <circle cx="10.9" cy="12.7" r="5.7" fill={palette.shell} />
      <ellipse
        cx="8.8"
        cy="10.1"
        rx="2.1"
        ry="1.5"
        fill={palette.shellHighlight}
        opacity="0.82"
        transform="rotate(-28 8.8 10.1)"
      />
      <circle cx="8.6" cy="11.2" r="0.9" fill={palette.accent} opacity="0.92" />
      {variant === "spent" ? (
        <path
          d="M6.6 17.2L15.3 8.6"
          fill="none"
          stroke="#f3f5f7"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
};
