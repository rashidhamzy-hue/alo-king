/** The hand-drawn crown (DECISIONS §37.2): slightly uneven lines, three points, three dots. Uses the current text colour. */
export function Crown({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        d="M7.2 37.4C6 29.6 5.1 19.8 4.6 13.1c5.3 4 9.7 8.2 15 12 3.5-6.9 7.4-13.4 12.3-19.2 5.1 5.9 8.9 12.5 12.6 19.3 5.4-3.8 9.5-8 14.8-12.1-.5 6.8-1.5 16.4-2.6 24.2-12.4 3.6-38.4 3.5-49.5.1Z"
        fill="currentColor"
        fillOpacity=".16"
      />
      <path d="M10.4 42.2c13.4 2.6 30.6 2.7 43.3-.2" />
      <path d="M16 31.5c5.2 1.5 26.7 1.6 32.2.1" strokeWidth="1.8" opacity=".7" />
      <circle cx="4.4" cy="9.6" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="32" cy="3.9" r="2.8" fill="currentColor" stroke="none" />
      <circle cx="59.7" cy="9.4" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
