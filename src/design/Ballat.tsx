import { useId } from "react";

/**
 * The old Lebanese cement tile (ballat) as a quiet section motif (DECISIONS §39.15.5): a four-petal flower in a diamond,
 * with quarter circles at the corners that join into rings across the floor, as in the tiled houses of the Shouf. A small
 * static inline SVG pattern (no image request, never a paint candidate) in the tone's own text colour at very low
 * opacity, so it reads at night and by day. Put it first inside an element with the `ak-ballat` class.
 */
export function Ballat() {
  const id = `ak-ballat-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="ak-ballat-tex" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width="64" height="64" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1.1">
            <circle cx="0" cy="0" r="14" />
            <circle cx="64" cy="0" r="14" />
            <circle cx="0" cy="64" r="14" />
            <circle cx="64" cy="64" r="14" />
            <path d="M32 6 58 32 32 58 6 32Z" strokeOpacity=".6" />
            <path d="M32 14c6 6 6 12 0 18-6-6-6-12 0-18ZM32 50c6-6 6-12 0-18-6 6-6 12 0 18ZM14 32c6-6 12-6 18 0-6 6-12 6-18 0ZM50 32c-6-6-12-6-18 0 6 6 12 6 18 0Z" />
          </g>
          <circle cx="32" cy="32" r="2.2" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
