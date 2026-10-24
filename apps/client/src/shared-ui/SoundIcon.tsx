export const SoundIcon = ({ enabled }: { enabled: boolean }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.65"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
    {enabled ? (
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    ) : (
      <path d="M16 9l5 6M21 9l-5 6" />
    )}
  </svg>
);
