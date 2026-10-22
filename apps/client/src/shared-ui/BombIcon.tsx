interface BombIconProps {
  spent?: boolean;
  className?: string;
  size?: number;
}

export const BombIcon = ({ spent = false, className, size = 24 }: BombIconProps) => (
  <svg
    aria-hidden="true"
    className={className}
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.65"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {spent ? (
      <path
        fill="currentColor"
        stroke="none"
        d="m12 2 2.5 6 6-3-3 6 5 3-6 1 1 7-5.5-4-5 4 1-7-6-1 5-3-3-6 6 3Z"
      />
    ) : (
      <>
        <circle cx="10" cy="14" r="7" />
        <path d="m14 8 2-3c1-1.7 3-1.8 4-.4M18 2l.5-1M21 3l1-.6M21 6l1 .4M6 12c.5-1.2 1.6-2 3-2" />
      </>
    )}
  </svg>
);
