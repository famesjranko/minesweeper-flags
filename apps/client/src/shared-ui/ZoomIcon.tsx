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
    <path
      d={
        zoomed ? "M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" : "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"
      }
    />
  </svg>
);
