interface FlagIconProps {
  color: "blue" | "red";
  className?: string;
  size?: number;
}

const PALETTE = {
  blue: {
    fill: "#2e49c6",
    shadow: "#132272",
    pole: "#101820"
  },
  red: {
    fill: "#f25131",
    shadow: "#9e1a0d",
    pole: "#2d120f"
  }
} as const;

export const FlagIcon = ({ color, className, size = 22 }: FlagIconProps) => {
  const palette = PALETTE[color];

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      <rect x="5.5" y="2.5" width="2.2" height="15.5" rx="1" fill={palette.pole} />
      <path d="M8.2 3.2H18.8L15.4 8.1L18.8 13H8.2Z" fill={palette.fill} />
      <path d="M8.2 3.2H18.8L16.5 6.6H8.2Z" fill="rgba(255,255,255,0.28)" />
      <path d="M8.2 13H18.8L16 16.6H8.2Z" fill={palette.shadow} />
      <rect x="3.5" y="18" width="7.8" height="2.2" rx="1.1" fill={palette.pole} />
    </svg>
  );
};
