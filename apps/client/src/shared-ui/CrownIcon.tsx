interface CrownIconProps {
  className?: string;
}

// Drawn rather than an emoji, so the crown looks the same on every platform.
export const CrownIcon = ({ className }: CrownIconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 18"
    width="24"
    height="18"
    role="img"
    aria-label="Winner"
  >
    <path
      d="M2 6.5 7 10.5 12 2.5 17 10.5 22 6.5 20 15.5H4Z"
      fill="#ffd54a"
      stroke="#9a6a00"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <rect x="4" y="15" width="16" height="2.2" rx="1" fill="#e2a91a" />
    <circle cx="12" cy="2.5" r="1.6" fill="#fff4c2" />
  </svg>
);
