export const ZoomIcon = ({ zoomed }: { zoomed: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.65"
    strokeLinecap="round"
  >
    <circle cx="10" cy="10" r="6.5" />
    <path d="m15 15 6 6M7 10h6" />
    {!zoomed ? <path d="M10 7v6" /> : null}
  </svg>
);
