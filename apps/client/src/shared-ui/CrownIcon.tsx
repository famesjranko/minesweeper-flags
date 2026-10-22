interface CrownIconProps {
  className?: string;
}

export const CrownIcon = ({ className }: CrownIconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    width="18"
    height="18"
    role="img"
    aria-label="Winner"
  >
    <path
      d="m3 6 5 4 4-6 4 6 5-4-2 12H5Z"
      fill="#efc45a"
      stroke="#ffdf89"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M6 15h12M6 20h12" fill="none" stroke="#c69235" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
